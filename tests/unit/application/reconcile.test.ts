import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeSheetTransport } from '@/integrations/google/fake-sheet';
import { FakeDriveGateway } from '@/integrations/google/fake-drive';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';
import { buildReconcileReport } from '@/application/reconcile';
import { saveDraft } from '@/application/draft-save';
import { readSection } from '@/application/markdown-source';
import { applyReviewTransition } from '@/application/review';
import { previewPromotion, promote } from '@/application/schedule';
import { evaluateAlerts, THRESHOLDS } from '@/observability/alerts';
import { emit, recentEvents, setTelemetrySink, type TelemetryEvent } from '@/observability/events';
import { ERROR_CATALOGUE, ERROR_CODES } from '@/domain/errors';
import { SYNTH_MASTER_FILE_ID } from '@/fixtures/synthetic';
import type { Actor } from '@/domain/mutation';

const owner: Actor = { sub: '100000000000000000001', role: 'owner' };
let sheet: FakeSheetTransport;
let drive: FakeDriveGateway;
let repo: SheetsContentRepository;
let events: (TelemetryEvent & { at: string })[];

beforeEach(() => {
  process.env.CS_FAKE_TODAY = '2026-09-30';
  sheet = new FakeSheetTransport();
  drive = new FakeDriveGateway();
  repo = new SheetsContentRepository(sheet);
  events = [];
  setTelemetrySink((e) => events.push(e));
});
afterEach(() => {
  setTelemetrySink(null);
  delete process.env.CS_FAKE_TODAY;
});

const NOW = Date.parse('2026-10-05T00:00:00+08:00');

describe('reconciliation items are recomputed from the authorities', () => {
  it('lists stale approvals, stale zh-TW and duplicate Markdown sections from synthetic data', async () => {
    const r = await buildReconcileReport(repo, drive, NOW);
    const kinds = r.items.map((i) => `${i.kind}:${i.stableIds.join(',')}`);
    expect(kinds).toContain('stale_approval:SYN-L006');
    expect(kinds).toContain('zh_stale:2026-10-02-MAIN-X');
    expect(kinds).toContain('markdown_missing:SYN-L003');
    expect(r.items.every((i) => i.facts.length > 0 && i.action.label)).toBe(true);
  });

  it('REV-09: a mismatch closes only after the sources actually agree', async () => {
    const lib = await repo.getLibrary('SYN-L001');
    const col = sheet.rawTab('Content Library')[0]!.findIndex((c) => c.value === 'Draft Content');
    sheet.externalEdit('Content Library', lib.row, col, 'Edited only in the Sheet');
    let r = await buildReconcileReport(repo, drive, NOW);
    expect(r.items.some((i) => i.kind === 'markdown_mismatch' && i.stableIds[0] === 'SYN-L001')).toBe(true);

    // Resolve through the normal save path: Markdown canonical text mirrored to the Sheet.
    const fresh = await repo.getLibrary('SYN-L001');
    const section = await readSection(drive, fresh);
    if (!section.ok) throw new Error('section');
    const saved = await saveDraft(repo, drive, { operationId: 'op_reconcile_fix_1', actor: owner, libraryId: 'SYN-L001', expectedSheetRevision: fresh.revision, expectedSectionHash: section.section.bodyHash, proposed: section.section.body });
    expect(saved.ok).toBe(true);
    r = await buildReconcileReport(repo, drive, NOW);
    expect(r.items.some((i) => i.kind === 'markdown_mismatch' && i.stableIds[0] === 'SYN-L001')).toBe(false);
  });

  it('schema drift becomes a blocking item', async () => {
    const header = sheet.rawTab('Content Library')[0]!;
    sheet.externalEdit('Content Library', 1, header.findIndex((c) => c.value === 'Review Status'), 'Review state');
    const r = await buildReconcileReport(repo, drive, NOW);
    expect(r.items.find((i) => i.kind === 'schema_drift')?.facts).toContain('Missing or renamed: Review Status');
    expect(r.unreadable).toContain('Content Library');
  });

  it('an unreadable Markdown file is reported as unknown, not as clear', async () => {
    drive.failNext({ op: 'read', code: 'PROVIDER_UNAVAILABLE', fileId: SYNTH_MASTER_FILE_ID });
    const r = await buildReconcileReport(repo, drive, NOW);
    expect(r.unreadable.some((u) => u.startsWith('Markdown file'))).toBe(true);
  });

  it('a partial saga shows its operation id and target, and the retry uses the same id', async () => {
    const lib = await repo.getLibrary('SYN-L001');
    const section = await readSection(drive, lib);
    if (!section.ok) throw new Error('section');
    sheet.failNext({ op: 'write', code: 'PROVIDER_UNAVAILABLE' });
    const input = { operationId: 'op_partial_recon_1', actor: owner, libraryId: 'SYN-L001', expectedSheetRevision: lib.revision, expectedSectionHash: section.section.bodyHash, proposed: 'Partially saved' };
    expect(await saveDraft(repo, drive, input)).toMatchObject({ ok: false, code: 'PARTIAL_FAILURE' });
    let r = await buildReconcileReport(repo, drive, NOW);
    const partial = r.items.find((i) => i.kind === 'partial_mutation');
    expect(partial?.operationId).toBe('op_partial_recon_1');
    expect(partial?.stableIds).toEqual(['SYN-L001']);
    // OBS-07: retrying the original operation completes without a second Drive write.
    const retry = await saveDraft(repo, drive, input);
    expect(retry.ok).toBe(true);
    expect(drive.writes).toHaveLength(1);
    r = await buildReconcileReport(repo, drive, NOW);
    expect(r.items.some((i) => i.operationId === 'op_partial_recon_1')).toBe(false);
  });

  it('published rows not synced for 48 hours are flagged', async () => {
    const r = await buildReconcileReport(repo, drive, NOW);
    expect(r.items.filter((i) => i.kind === 'stale_published_sync').map((i) => i.stableIds[0])).toEqual(expect.arrayContaining(['2026-10-01-MAIN-X']));
    expect(r.alerts.map((a) => a.id)).toContain('stale_published_sync');
  });
});

describe('OBS-08: alert thresholds', () => {
  const at = new Date(NOW).toISOString();
  it('schema drift pages immediately', () => {
    expect(evaluateAlerts([{ name: 'sheet.schema_drift', adapter: 'sheet', outcome: 'error', code: 'SCHEMA_DRIFT', at }], 0, NOW)[0]?.id).toBe('schema_drift');
  });
  it('token refresh alerts at the consecutive threshold only', () => {
    const ev = (n: number) => ({ name: 'google.token_refresh_failed', adapter: 'auth' as const, outcome: 'error' as const, facts: { consecutive: n }, at });
    expect(evaluateAlerts([ev(THRESHOLDS.authRefreshConsecutive - 1)], 0, NOW)).toEqual([]);
    expect(evaluateAlerts([ev(THRESHOLDS.authRefreshConsecutive)], 0, NOW)[0]?.id).toBe('auth_refresh');
  });
  it('provider write failures alert within the window, not outside it', () => {
    const fail = (ms: number) => ({ name: 'sheet.write.library', adapter: 'sheet' as const, outcome: 'error' as const, at: new Date(NOW - ms).toISOString() });
    expect(evaluateAlerts([fail(1000), fail(2000), fail(3000)], 0, NOW)[0]?.id).toBe('provider_write');
    expect(evaluateAlerts([fail(1000), fail(2000), fail(THRESHOLDS.providerWriteWindowMs + 1000)], 0, NOW)).toEqual([]);
  });
});

describe('OBS-05 / OBS-06: typed errors and provable redaction', () => {
  it('every error code has a user message and a recovery action', () => {
    for (const code of ERROR_CODES) {
      expect(ERROR_CATALOGUE[code].message.length).toBeGreaterThan(20);
      expect(ERROR_CATALOGUE[code].recovery).toBeTruthy();
    }
  });

  it('telemetry never carries copy, Markdown, ids, URLs or owner identifiers across real flows', async () => {
    const SENTINEL = 'CS_COPY_SENTINEL_7F3A body text 談薪水';
    const lib = await repo.getLibrary('SYN-L005');
    const section = await readSection(drive, lib);
    if (!section.ok) throw new Error('section');
    await saveDraft(repo, drive, { operationId: 'op_sentinel_save_1', actor: owner, libraryId: 'SYN-L005', expectedSheetRevision: lib.revision, expectedSectionHash: section.section.bodyHash, proposed: SENTINEL });
    const saved = await repo.getLibrary('SYN-L005');
    await applyReviewTransition(repo, owner, { operationId: 'op_sentinel_rev_1', libraryId: 'SYN-L005', expectedRevision: saved.revision, action: 'approve_and_queue' });
    const p = await previewPromotion(repo, 'SYN-L005', '2026-10-01-MAIN-LI');
    if (p.ok) await promote(repo, owner, { operationId: 'op_sentinel_pro_1', libraryId: 'SYN-L005', contentId: '2026-10-01-MAIN-LI', expectedLibraryRevision: p.libraryRevision, expectedScheduleRevision: p.scheduleRevision });
    // A careless caller trying to log unsafe facts is redacted too.
    emit({ name: 'careless.caller', adapter: 'app', outcome: 'ok', facts: { draft: SENTINEL, url: 'https://drive.google.com/file/d/SYNTH_x/view', owner: owner.sub } });
    const text = JSON.stringify([...events, ...recentEvents()]);
    for (const forbidden of ['CS_COPY_SENTINEL_7F3A', '談薪水', 'SYN-L005', '2026-10-01-MAIN-LI', 'drive.google.com', owner.sub, SYNTH_MASTER_FILE_ID]) {
      expect(text).not.toContain(forbidden);
    }
    expect(events.length).toBeGreaterThan(5);
  });
});
