import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentExporter, ContentWriteCutover, contentExportRows, exportKey } from '@/application/content-export';
import { FakeContentDb, syntheticContentDbSeed } from '@/integrations/supabase/fake-content-db';
import { FakeSheetTransport } from '@/integrations/google/fake-sheet';
import { SupabaseContentRepository } from '@/integrations/supabase/content-repository';
import { SHEET_TABS, LIBRARY_HEADERS, SCHEDULE_HEADERS } from '@/domain/sheet-schema';
import { assertImportMode } from '@/application/content-import';
import { runConfiguredSheetMirror } from '@/lib/sheet-mirror-operation';
import { getServices, resetServices } from '@/application/container';
import { resetEnvCache, serverEnv } from '@/lib/env';
import { buildReconcileReport } from '@/application/reconcile';
import { FakeDriveGateway } from '@/integrations/google/fake-drive';
import { rowRevision } from '@/domain/mapping';
import { fingerprintValues } from '@/domain/hash';
import { repairContentExport, scheduledContentBackup } from '@/lib/content-maintenance';

const actor = { sub: 'synthetic-owner', role: 'owner' as const };
beforeEach(() => { vi.stubEnv('CS_DATA_MODE', 'fake'); vi.stubEnv('CS_CONTENT_STORE', 'db'); vi.stubEnv('VERCEL_ENV', 'preview'); resetEnvCache(); resetServices(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); resetEnvCache(); resetServices(); });
function setup(now = () => Date.now()) {
  const db = new FakeContentDb(), sheet = new FakeSheetTransport();
  const exporter = new ContentExporter(db, sheet, { checkpoints: new Map(), issues: new Map(), reports: [] }, now);
  const cutover = new ContentWriteCutover(new SupabaseContentRepository(db), exporter);
  return { db, sheet, exporter, cutover, repo: cutover.repo };
}
async function save(repo: SupabaseContentRepository | ContentWriteCutover['repo'], operationId = 'synthetic-export-save', text = 'Synthetic DB save') {
  const row = await repo.getLibrary('SYN-L001');
  return repo.updateLibrary({ operationId, actor, target: { libraryId: 'SYN-L001' }, expectedRevision: row.revision, patch: { draftContent: text } });
}

describe('MIG-12 one-way stable-ID export', () => {
  it('exports all typed fields byte-equal, including Typefully sync fields and formula links; no-op repair writes nothing', async () => {
    const { db, sheet, exporter } = setup();
    const raw = (await db.listSchedule())[0]!;
    db.externalEdit('schedule', raw.content_id, { final_content: 'Exact final\ncopy  ', final_synced_at: '2026-10-01T00:00:00Z', final_synced_hash: 'abc12345', published_at: '2026-10-01T01:02:03Z', analytics_synced_at: '2026-10-01T03:00:00Z', views: 1234, likes: 0, reposts: 2, replies: 3, bookmarks: 4, new_followers: 5 });
    const formulas = sheet.rawTab(SHEET_TABS.library.name).flat().filter(c => c.formula).map(c => c.formula);
    const first = await exporter.run();
    expect(first.exact).toBe(true); expect(first.dbHash).toBe(first.sheetHash);
    expect(first.counts).toEqual({ library: 12, queue: 5, schedule: 21, workflow_settings: 18 });
    expect(sheet.rawTab(SHEET_TABS.library.name).flat().filter(c => c.formula).map(c => c.formula)).toEqual(formulas);
    const count = sheet.writes.length, reads = sheet.reads;
    await exporter.run(); expect(sheet.writes).toHaveLength(count); expect(sheet.reads - reads).toBeLessThanOrEqual(10);
    const projected = await contentExportRows(db);
    expect(projected.find(r => r.id === raw.content_id)!.cells[SCHEDULE_HEADERS.finalContent]!.value).toBe('Exact final\ncopy  ');
    expect(projected.find(r => r.id === raw.content_id)!.cells[SCHEDULE_HEADERS.finalSyncedAt]!.value).toBe('2026-10-01T08:00:00+08:00 #abc12345');
  });
  it('preserves an injected Sheet hand edit and emits blocking differing field names on every repair', async () => {
    const { db, sheet, exporter, repo, cutover } = setup(); await exporter.run();
    const tab = SHEET_TABS.library.name, headers = sheet.rawTab(tab)[0]!.map(c => c.value), column = headers.indexOf(LIBRARY_HEADERS.draftContent);
    const old = exporter.journal.checkpoints.get(exportKey('library', 'SYN-L001'))!;
    sheet.externalEdit(tab, 2, column, 'Synthetic hand edit  ');
    expect((await save(repo)).ok).toBe(true);
    expect((await db.getPost('library', 'SYN-L001'))!.draft_content).toBe('Synthetic DB save');
    expect(sheet.rawTab(tab)[1]![column]!.value).toBe('Synthetic hand edit  ');
    expect(exporter.journal.checkpoints.get(exportKey('library', 'SYN-L001'))).toEqual(old);
    expect(exporter.journal.issues.get(exportKey('library', 'SYN-L001'))).toMatchObject({ reason: 'export_mismatch', fields: ['Draft Content'] });
    await exporter.run(); expect(sheet.rawTab(tab)[1]![column]!.value).toBe('Synthetic hand edit  ');
    const report = await buildReconcileReport(repo, new FakeDriveGateway(), Date.now(), { contentCutover: cutover, backupJournal: { lastVerified: null, failureSince: null } });
    expect(report.items).toContainEqual(expect.objectContaining({ kind: 'export_mismatch', severity: 'blocking', facts: [expect.stringContaining('Draft Content')], stableIds: ['SYN-L001'] }));
    expect(report.items.some(i => i.kind === 'backup_fresh')).toBe(true);
  });
  it('detects a formula-only or unknown-column hand edit even with unchanged display; locates moved rows by stable ID', async () => {
    const { sheet, exporter, repo } = setup(); await exporter.run();
    const tab = SHEET_TABS.library.name, grid = sheet.rawTab(tab), headers = grid[0]!.map(c => c.value);
    grid[1]!.push({ value: 'Private synthetic metadata' }); grid[0]!.push({ value: 'Synthetic custom' });
    grid[1]![headers.indexOf(LIBRARY_HEADERS.sourceMarkdown)]!.formula = '=HYPERLINK("https://example.com/changed","same")';
    [grid[1], grid[2]] = [grid[2]!, grid[1]!];
    expect((await save(repo)).ok).toBe(true);
    expect(exporter.journal.issues.get(exportKey('library', 'SYN-L001'))!.fields).toEqual(expect.arrayContaining(['Source Markdown', 'Synthetic custom']));
    expect(grid[2]![headers.indexOf(LIBRARY_HEADERS.draftContent)]!.value).not.toBe('Synthetic DB save');
  });
  it('detects an imported-row hand edit before the first export', async () => {
    const { sheet, exporter } = setup();
    sheet.externalEdit(SHEET_TABS.library.name, 2, Object.keys(LIBRARY_HEADERS).indexOf('draftContent'), 'Synthetic edit before export');
    expect((await exporter.run()).exact).toBe(false);
    expect(exporter.journal.issues.get(exportKey('library', 'SYN-L001'))!.reason).toBe('export_mismatch');
  });
  it('never calls differing inventory hashes exact when an unknown empty column appears', async () => {
    const { sheet, exporter } = setup(); await exporter.run();
    sheet.rawTab(SHEET_TABS.library.name)[0]!.push({ value: 'Synthetic added blank column' });
    const parity = await exporter.parity();
    expect(parity.dbHash).not.toBe(parity.sheetHash); expect(parity.exact).toBe(false);
    expect(parity.differences[0]!.fields).toContain('Synthetic added blank column');
  });
  it('requires explicit authenticated, idempotent resolution with both current tokens; retry cannot overwrite a later edit', async () => {
    const { db, sheet, exporter } = setup(); await exporter.run();
    const tab = SHEET_TABS.library.name, grid = sheet.rawTab(tab), col = Object.keys(LIBRARY_HEADERS).indexOf('draftContent');
    sheet.externalEdit(tab, 2, col, 'Synthetic hand edit'); await exporter.run();
    const token = () => fingerprintValues([rowRevision(grid[1]!.map(c => c.value), grid[0]!.length), rowRevision(grid[1]!.map(c => c.formula ?? c.value), grid[0]!.length)]);
    const input = { actor, operationId: 'synthetic-export-decision', kind: 'library' as const, id: 'SYN-L001', expectedSheetFingerprint: token(), expectedDbVersion: String((await db.getPost('library', 'SYN-L001'))!.row_version) };
    await expect(exporter.resolveMismatch({ ...input, actor: { ...actor, role: 'viewer' } })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(exporter.resolveMismatch({ ...input, expectedSheetFingerprint: '0000000000000000' })).rejects.toMatchObject({ code: 'STALE_READ' });
    expect((await exporter.resolveMismatch(input)).exact).toBe(true); expect(exporter.journal.decisions!.size).toBe(1);
    expect((await exporter.resolveMismatch(input)).exact).toBe(true);
    await expect(exporter.resolveMismatch({ ...input, expectedDbVersion: '999' })).rejects.toMatchObject({ code: 'CONFLICT' });
    sheet.externalEdit(tab, 2, col, 'Synthetic later edit');
    expect((await exporter.resolveMismatch(input)).exact).toBe(false); expect(grid[1]![col]!.value).toBe('Synthetic later edit');
  });
  it('appends Replies Queue ideas exactly once across concurrent save retries and repair', async () => {
    const { sheet, repo, exporter } = setup(); await exporter.run();
    const idea = { operationId: 'synthetic-queue-export', actor, libraryId: 'SYN-NEWIDEA', sourcePlatform: 'X' as const, currentHook: 'Synthetic idea', draftContent: 'Synthetic\nbody  ' };
    const before = sheet.rawTab(SHEET_TABS.queue.name).length;
    expect((await Promise.all([repo.createQueueIdea(idea), repo.createQueueIdea(idea)])).every(r => r.ok)).toBe(true);
    await Promise.all([exporter.run(), exporter.run()]);
    expect(sheet.rawTab(SHEET_TABS.queue.name)).toHaveLength(before + 1);
    expect((await exporter.parity()).exact).toBe(true);
  });
  it('repairs a provider failure without converting a committed DB mutation to failure, with 15/60-minute lag severity', async () => {
    let now = 1_800_000_000_000; const { sheet, repo, exporter, cutover } = setup(() => now); await exporter.run();
    sheet.failNext({ op: 'write', tab: SHEET_TABS.library.name, code: 'PROVIDER_UNAVAILABLE' });
    expect((await save(repo)).ok).toBe(true);
    expect(exporter.journal.issues.get(exportKey('library', 'SYN-L001'))!.reason).toBe('export_lag');
    for (const [elapsed, severity] of [[900_000, 'attention'], [3600_000, 'blocking']] as const) {
      const report = await buildReconcileReport(repo, new FakeDriveGateway(), now + elapsed, { contentCutover: cutover });
      expect(report.items).toContainEqual(expect.objectContaining({ kind: 'export_lag', severity }));
    }
    now += 3600_001; expect((await exporter.run()).exact).toBe(true); expect(exporter.journal.issues.size).toBe(0);
  });
  it('exports a committed SQL step even when the mutation confirmation read failed', async () => {
    const { db, repo, exporter } = setup(); await exporter.run();
    vi.spyOn(db, 'mutationRow').mockRejectedValueOnce(new Error('synthetic confirmation failure'));
    expect(await save(repo)).toMatchObject({ ok: false, code: 'PARTIAL_FAILURE', steps: [expect.objectContaining({ provider: 'db', status: 'done' }), expect.anything()] });
    expect((await exporter.parity()).exact).toBe(true);
  });
  it('never recreates deleted rows or ignores extra Sheet IDs; duplicate IDs fail closed', async () => {
    const { sheet, exporter } = setup(); await exporter.run();
    const grid = sheet.rawTab(SHEET_TABS.library.name), before = grid.length; grid.splice(1, 1);
    expect((await exporter.run()).exact).toBe(false); expect(grid).toHaveLength(before - 1);
    grid.push(structuredClone(grid[1]!));
    await expect(exporter.parity()).rejects.toMatchObject({ code: 'SCHEMA_DRIFT' });
  });
  it('retains unknown-column passthrough and refuses unexportable formula changes', async () => {
    const seed = syntheticContentDbSeed(), sheet = new FakeSheetTransport(), grid = sheet.rawTab(SHEET_TABS.library.name);
    const column = grid[0]!.length;
    grid[0]!.push({ value: 'Synthetic extra' });
    for (const row of grid.slice(1)) row.push({ value: 'unknown  ' });
    for (const row of seed.posts.filter(r => r.collection === 'library')) {
      row.passthrough = { [column]: { header: 'Synthetic extra', value: 'unknown  ', formula: 'unknown  ', link: '' } };
      row.sheet_revision = null; // Exact first comparison, no imported fingerprint available.
    }
    const db = new FakeContentDb(seed), exporter = new ContentExporter(db, sheet, { checkpoints: new Map(), issues: new Map(), reports: [] });
    expect((await exporter.run()).exact).toBe(true);
    const formulaHeader = Object.keys(LIBRARY_HEADERS).find(f => grid[1]![Object.keys(LIBRARY_HEADERS).indexOf(f)]?.formula);
    expect(formulaHeader).toBeTruthy();
    db.externalEdit('library', 'SYN-L001', { [formulaHeader!.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`)]: 'Synthetic changed display' });
    expect((await exporter.run()).exact).toBe(false);
    expect(grid[1]![column]!.value).toBe('unknown  ');
  });
});

describe('MIG-05/MIG-12 rollback and authority', () => {
  it('drains writes, final-exports, records equal hashes, flips last and refuses subsequent writes', async () => {
    const { repo, exporter, cutover } = setup(); await exporter.run();
    expect((await save(repo)).ok).toBe(true);
    const order: string[] = [];
    vi.spyOn(exporter, 'run').mockImplementationOnce(async () => { order.push('final export'); return exporter.parity(); });
    const result = await cutover.rollbackToSheet(async mode => {
      order.push(mode); expect((await exporter.parity()).exact).toBe(true);
      expect(await save(repo, 'synthetic-refused')).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    });
    expect(order).toEqual(['final export', 'sheet']); expect(result.parity.dbHash).toBe(result.parity.sheetHash);
    expect((await save(repo, 'synthetic-later')).ok).toBe(false);
  });
  it('does not flip on hand edit, unreadable Sheet, or parity failure and leaves writes disabled', async () => {
    const { sheet, exporter, cutover, repo } = setup(); await exporter.run();
    sheet.externalEdit(SHEET_TABS.library.name, 2, Object.keys(LIBRARY_HEADERS).indexOf('draftContent'), 'Synthetic rollback conflict');
    const flip = vi.fn(); await expect(cutover.rollbackToSheet(flip)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(flip).not.toHaveBeenCalled(); expect((await save(repo)).ok).toBe(false);
  });
  it('blocks typed and legacy imports in db mode even with legacy flags; sheet is the default', async () => {
    expect(() => assertImportMode()).toThrow();
    await expect(runConfiguredSheetMirror({ kind: 'scheduled' })).rejects.toMatchObject({ code: 'FORBIDDEN', details: { reason: 'imports_disabled_in_db_mode' } });
    expect(getServices().contentImport).toBeUndefined();
    vi.stubEnv('CS_CONTENT_STORE', undefined); resetEnvCache(); expect(serverEnv().CS_CONTENT_STORE).toBe('sheet');
  });
  it('explicitly refuses every live database mode without constructing a live client', () => {
    vi.stubEnv('CS_DATA_MODE', 'live');
    for (const mode of ['db', 'db-read', 'db-shadow']) {
      vi.stubEnv('CS_CONTENT_STORE', mode); resetEnvCache(); resetServices();
      expect(() => getServices()).toThrow('database modes are not enabled for live data');
    }
    const fake = setup();
    expect(() => new ContentExporter({ ...fake.db, mode: 'live' } as never, fake.sheet, fake.exporter.journal)).toThrow();
  });
  it('composition wires post-mutation/repair/backup only in fake db; write-disable flag is enforced', async () => {
    let services = getServices(); expect(services.contentCutover).toBeDefined();
    expect((await save(services.repo)).ok).toBe(true); expect((await repairContentExport()).exact).toBe(true);
    expect(await scheduledContentBackup()).toMatchObject({ status: 'verified' });
    expect(await scheduledContentBackup()).toMatchObject({ status: 'already_verified' });
    vi.stubEnv('CS_CONTENT_WRITE_ENABLED', 'false'); resetEnvCache(); resetServices(); services = getServices();
    expect(services.repo.capability().state).toBe('read_only');
    expect(await save(services.repo)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });
  it('daily comparison never counts missing days/samples green, needs 14 days AND 50 mutations, rejects lag and old failures', async () => {
    let now = Date.parse('2026-10-01T04:00:00Z'); const { exporter, repo } = setup(() => now);
    await exporter.run();
    for (let i = 0; i < 14; i++) {
      now = Date.parse('2026-10-01T04:00:00Z') + i * 86400_000;
      expect((await save(repo, `synthetic-daily-${i}`, `Synthetic day ${i}`)).ok).toBe(true);
    }
    now = Date.parse('2026-10-15T04:00:00Z');
    expect(exporter.comparison(now, 49).ready).toBe(false); expect(exporter.comparison(now, 50).ready).toBe(true);
    expect(exporter.comparison(now + 86400_000, 50).ready).toBe(false);
    exporter.lagSamples.push({ at: now - 86400_000, lagMs: 900_001 });
    expect(exporter.comparison(now, 50).ready).toBe(false);
    exporter.lagSamples.pop(); exporter.repairedFailures.push({ since: now - 28 * 3600_000, repairedAt: now - 26 * 3600_000 });
    expect(exporter.comparison(now, 50).ready).toBe(false);
  });
});
