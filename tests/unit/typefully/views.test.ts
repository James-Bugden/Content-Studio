import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setTelemetrySink } from '@/observability/events';
import { buildReconcileReport } from '@/application/reconcile';
import { createDraft, reconcile, syncFromTypefully } from '@/application/typefully';
import { clientResult, loadTypefullyDetail, panelView } from '@/application/typefully-view';
import { FakeDriveGateway } from '@/integrations/google/fake-drive';
import { UnconfiguredTypefullyGateway } from '@/integrations/typefully/fake-gateway';
import {
  METRIC_UNAVAILABLE,
  finalEditedSinceSync,
  formatTaipei,
  isPublishedRow,
  parsePlatformFilter,
  parseRangePreset,
  publishedRowView,
  rangeFrom,
  syncFreshness,
} from '@/domain/typefully-view';
import { finalTextHash, formatSyncStamp } from '@/domain/typefully';
import { NOW, captureTelemetry, owner, setup } from './harness';

beforeEach(() => {
  captureTelemetry();
  process.env.CS_FAKE_TODAY = '2026-09-30';
});
afterEach(() => {
  setTelemetrySink(null);
  delete process.env.CS_FAKE_TODAY;
});

const X1 = '2026-10-01-MAIN-X';
const TH1 = '2026-10-01-MAIN-TH';
const X2 = '2026-10-02-MAIN-X';
const LI2 = '2026-10-02-MAIN-LI';
const AT = Date.parse('2026-10-02T12:00:00+08:00');

describe('published row view (PUB-01, PUB-02, PUB-04)', () => {
  it('a blank metric stays null (not available), a zero stays 0', async () => {
    const { row } = setup();
    const x = await row(X1);
    const v = publishedRowView(x.value, x.revision, AT);
    const byKey = Object.fromEntries(v.metrics.map((m) => [m.key, m.value]));
    expect(byKey.replies).toBe(0);
    expect(byKey.newFollowers).toBeNull();
    expect(byKey.views).toBe(1520);
    expect(METRIC_UNAVAILABLE).toBe('Not available from Typefully');
    expect(v.finalContent).toBe(x.value.finalContent);
    expect(v.platform).toBe('X');
    expect(v.publishedAtTaipei).toBe('1 Oct 2026, 08:00');
  });

  it('keeps X and Threads as separate rows with their own lineage', async () => {
    const { row } = setup();
    const th = await row(TH1);
    const v = publishedRowView(th.value, th.revision, AT);
    expect(v.platform).toBe('Threads');
    expect(v.parentContentId).toBe(X1);
    // Threads fixture has no post link: shown for reconciliation, never inferred.
    expect(v.problems).toContain('Published, but no post link is recorded.');
  });

  it('a post link on a row that is not Published is a disagreement to reconcile', async () => {
    const { row, edit } = setup();
    await edit(X2, 'postLink', 'https://x.com/example/status/1');
    const x2 = await row(X2);
    expect(isPublishedRow(x2.value)).toBe(true);
    expect(publishedRowView(x2.value, x2.revision, AT).problems[0]).toMatch(/Typefully Status is Scheduled, but a publish time or post link is recorded/);
  });

  it('sync freshness distinguishes fresh, stale, never and unreadable', () => {
    expect(syncFreshness('', AT)).toEqual({ at: null, state: 'never' });
    expect(syncFreshness('not a time', AT).state).toBe('unreadable');
    expect(syncFreshness('2026-10-02T09:00:00+08:00 #1a2b3c4d', AT)).toEqual({ at: '2026-10-02T09:00:00+08:00', state: 'fresh' });
    expect(syncFreshness('2026-09-29T09:00:00+08:00', AT).state).toBe('stale');
  });

  it('formats Taipei times and URL filters accept enums only', () => {
    expect(formatTaipei('2026-10-01T00:15:02Z')).toBe('1 Oct 2026, 08:15');
    expect(formatTaipei('nope')).toBeNull();
    expect(parsePlatformFilter('Threads')).toBe('Threads');
    expect(parsePlatformFilter('X,Threads')).toBeNull();
    expect(parsePlatformFilter(['X'])).toBeNull();
    expect(parseRangePreset('30d')).toBe('30d');
    expect(parseRangePreset('365d')).toBeNull();
    expect(rangeFrom('7d', '2026-10-05')).toBe('2026-09-28');
    expect(rangeFrom(null, '2026-10-05')).toBeNull();
  });

  it('finalEditedSinceSync needs a hashed stamp to say anything', () => {
    const at = new Date('2026-10-01T00:00:00Z');
    expect(finalEditedSinceSync({ finalContent: 'a', finalSyncedAt: formatSyncStamp(at, 'a') })).toBe(false);
    expect(finalEditedSinceSync({ finalContent: 'a edited', finalSyncedAt: formatSyncStamp(at, 'a') })).toBe(true);
    expect(finalEditedSinceSync({ finalContent: 'a', finalSyncedAt: '2026-10-01T09:00:00+08:00' })).toBeNull();
    expect(finalTextHash('a')).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('client-safe Typefully views never carry provider-only fields', () => {
  it('panel views drop idempotency markers and raw draft objects', async () => {
    const { repo, tf } = setup([
      { id: 'SYNTH-TF-1201', platform: 'LinkedIn', text: 'Old post using a screenshot.', status: 'Planned', scheduledAt: '2026-10-02T13:00:00Z', updatedAt: '2026-09-29T00:00:00Z' },
      { id: 'SYNTH-TF-1202', platform: 'LinkedIn', text: 'Something else entirely.', status: 'Planned', scheduledAt: '2026-10-02T13:30:00Z', updatedAt: '2026-09-29T00:00:00Z' },
    ]);
    const view = panelView(await reconcile(repo, tf, LI2));
    expect(view.kind).toBe('ambiguous');
    if (view.kind !== 'ambiguous') return;
    expect(view.candidates.map((c) => c.draftId)).toEqual(['SYNTH-TF-1201', 'SYNTH-TF-1202']);
    expect(view.candidates[0]).toMatchObject({ date: '2026-10-02', time: '21:00', platform: 'LinkedIn', text: 'Old post using a screenshot.' });
    const json = JSON.stringify(view);
    expect(json).not.toContain('idempotencyKey');
    expect(json).not.toContain('perPlatform');
  });

  it('a created draft result exposes the revision, not the draft or its marker', async () => {
    const { repo, tf, input } = setup();
    const r = clientResult(await createDraft(repo, tf, owner, await input(LI2, 'op_view_create'), { now: NOW }));
    expect(r).toMatchObject({ ok: true, replayed: false, typefullyStatus: 'Planned' });
    expect(JSON.stringify(r)).not.toMatch(/cs[0-9a-f]{8}|SYNTH-TF-2001|idempotency/);
  });

  it('a refused create carries the service reason and a mapped reconciliation', async () => {
    const { repo, tf, input } = setup([
      { id: 'SYNTH-TF-1201', platform: 'LinkedIn', text: 'Old post using a screenshot.', status: 'Planned', scheduledAt: '2026-10-02T13:00:00Z', updatedAt: '2026-09-29T00:00:00Z' },
      { id: 'SYNTH-TF-1202', platform: 'LinkedIn', text: 'Old post using a screenshot!', status: 'Planned', scheduledAt: '2026-10-02T13:02:00Z', updatedAt: '2026-09-29T00:00:00Z' },
    ]);
    const r = clientResult(await createDraft(repo, tf, owner, await input(LI2, 'op_view_amb'), { now: NOW }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('AMBIGUOUS_MATCH');
    expect(r.details?.reason).toBe('candidates_exist');
    expect((r.details?.reconciliation as { kind: string }).kind).toBe('ambiguous');
    expect(JSON.stringify(r)).not.toContain('perPlatform');
  });

  it('the detail view reports Threads zh freshness from the parent X row', async () => {
    const { repo, tf } = setup();
    const th2 = await loadTypefullyDetail(repo, tf, '2026-10-02-MAIN-TH');
    expect(th2.row.zh).toEqual({ xContentId: X2, state: 'stale' });
    const th1 = await loadTypefullyDetail(repo, tf, TH1);
    expect(th1.row.zh?.state).toBe('approved');
    expect(th1.panel.kind).toBe('linked');
    await expect(loadTypefullyDetail(repo, tf, '2026-12-31-MAIN-X')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('reconciliation centre: Typefully items', () => {
  const drive = () => new FakeDriveGateway();

  it('lists ambiguous candidates for a Ready row without a Draft ID in the next 7 days, linking to the row', async () => {
    const { repo, tf } = setup([
      { id: 'SYNTH-TF-1201', platform: 'LinkedIn', text: 'Old post using a screenshot.', status: 'Planned', scheduledAt: '2026-10-02T13:00:00Z', updatedAt: '2026-09-29T00:00:00Z' },
      { id: 'SYNTH-TF-1202', platform: 'LinkedIn', text: 'Old post, again.', status: 'Planned', scheduledAt: '2026-10-02T13:20:00Z', updatedAt: '2026-09-29T00:00:00Z' },
    ]);
    const r = await buildReconcileReport(repo, drive(), AT, { typefully: tf, today: '2026-09-30' });
    const item = r.items.find((i) => i.kind === 'typefully_ambiguous');
    expect(item).toMatchObject({ stableIds: [LI2], action: { label: 'Review', href: `/schedule/${LI2}` } });
    expect(item?.title).toContain('2 Typefully drafts');
    expect(tf.calls.some((c) => c.op === 'createDraft')).toBe(false);
  });

  it('rows outside the 7-day window or already linked are not scanned', async () => {
    const { repo, tf } = setup([
      { id: 'SYNTH-TF-1201', platform: 'LinkedIn', text: 'a', status: 'Planned', scheduledAt: '2026-10-02T13:00:00Z', updatedAt: '2026-09-29T00:00:00Z' },
      { id: 'SYNTH-TF-1202', platform: 'LinkedIn', text: 'b', status: 'Planned', scheduledAt: '2026-10-02T13:20:00Z', updatedAt: '2026-09-29T00:00:00Z' },
    ]);
    const r = await buildReconcileReport(repo, drive(), AT, { typefully: tf, today: '2026-10-10' });
    expect(r.items.some((i) => i.kind === 'typefully_ambiguous')).toBe(false);
    expect(tf.calls.filter((c) => c.op === 'listDrafts')).toHaveLength(0);
  });

  it('flags Final Content edited in the Sheet after the last sync, and clears when it matches again', async () => {
    const { repo, tf, input, edit } = setup();
    expect((await syncFromTypefully(repo, tf, owner, await input(X2, 'op_rc_sync'), { now: NOW })).ok).toBe(true);
    let r = await buildReconcileReport(repo, drive(), AT, { typefully: tf, today: '2026-09-30' });
    expect(r.items.some((i) => i.kind === 'typefully_sync_conflict')).toBe(false);
    await edit(X2, 'finalContent', 'Edited in the Sheet by hand');
    r = await buildReconcileReport(repo, drive(), AT, { typefully: tf, today: '2026-09-30' });
    expect(r.items.find((i) => i.kind === 'typefully_sync_conflict')).toMatchObject({ stableIds: [X2], action: { label: 'Compare', href: `/schedule/${X2}` } });
  });

  it('a Typefully failure during the scan is unknown, not clear', async () => {
    const { repo, tf } = setup();
    tf.failNext('PROVIDER_UNAVAILABLE', 'listDrafts');
    const r = await buildReconcileReport(repo, drive(), AT, { typefully: tf, today: '2026-09-30' });
    expect(r.unreadable).toContain('Typefully drafts');
  });

  it('an unconfigured Typefully is not scanned', async () => {
    const { repo } = setup();
    const r = await buildReconcileReport(repo, drive(), AT, { typefully: new UnconfiguredTypefullyGateway(), today: '2026-09-30' });
    expect(r.unreadable).not.toContain('Typefully drafts');
    expect(r.items.some((i) => i.kind === 'typefully_ambiguous')).toBe(false);
  });
});
