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
import { MAX_TAB_ROWS } from '@/integrations/google/sheet-transport';
import { AppError } from '@/domain/errors';
import { createContentBackup } from '@/application/content-backup';
import { FakePrivateBackupFolder, emptyBackupSnapshot } from '@/integrations/supabase/fake-content-backup';

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
  it('CS-059g: ordinary AppErrors do not skip the remaining rows of a tab', async () => {
    const { db, sheet, exporter } = setup(); await exporter.run();
    db.externalEdit('library', 'SYN-L001', { draft_content: 'Synthetic first change' });
    db.externalEdit('library', 'SYN-L002', { draft_content: 'Synthetic second change' });
    const read = sheet.readTab.bind(sheet);
    let failed = false;
    vi.spyOn(sheet, 'readTab').mockImplementation(async (...args) => {
      if (!failed && args[0] === SHEET_TABS.library.name) { failed = true; throw new AppError('PROVIDER_UNAVAILABLE'); }
      return read(...args);
    });
    await exporter.run();
    expect(failed).toBe(true);
    const grid = sheet.rawTab(SHEET_TABS.library.name);
    expect(grid.find(r => r.some(c => c.value === 'SYN-L002'))!.some(c => c.value === 'Synthetic second change')).toBe(true);
  });
  it.each([false, true])('CS-059g: hand edits keep direction advice alongside equals advice: %s', async (equals) => {
    const { sheet, exporter, repo, cutover } = setup(); await exporter.run();
    const grid = sheet.rawTab(SHEET_TABS.library.name);
    sheet.externalEdit(SHEET_TABS.library.name, 2, grid[0]!.findIndex(c => c.value === 'Current Hook'), 'Synthetic hand edit');
    if (equals) await save(repo, 'synthetic-both-conflicts', '=Synthetic literal');
    else await exporter.run();
    const report = await buildReconcileReport(repo, new FakeDriveGateway(), Date.now(), { contentCutover: cutover });
    const facts = report.items.find(i => i.kind === 'export_mismatch' && i.stableIds.includes('SYN-L001'))!.facts.join(' ');
    expect(facts).toContain('Review the direction in the cutover runbook; no automatic overwrite.');
    expect(facts.includes('Change authoritative value')).toBe(equals);
    expect(grid[1]![grid[0]!.findIndex(c => c.value === 'Current Hook')]!.value).toBe('Synthetic hand edit');
  });
  it('CS-059d: parity blocks an unknown-column hand edit on a DB-created idea', async () => {
    const seed = syntheticContentDbSeed(), sheet = new FakeSheetTransport();
    const grid = sheet.rawTab(SHEET_TABS.queue.name), column = grid[0]!.length;
    grid[0]!.push({ value: 'Synthetic extra' });
    for (const row of grid.slice(1)) row.push({ value: '' });
    for (const row of seed.posts.filter(r => r.collection === 'queue')) {
      row.passthrough = { [column]: { header: 'Synthetic extra', value: '', formula: '', link: '' } };
      const raw = grid.find(r => r.some(c => c.value === row.library_id))!;
      row.sheet_revision = fingerprintValues([rowRevision(raw.map(c => c.value), column + 1), rowRevision(raw.map(c => c.formula ?? c.value), column + 1)]);
    }
    const db = new FakeContentDb(seed), exporter = new ContentExporter(db, sheet, { checkpoints: new Map(), issues: new Map(), reports: [] });
    const cutover = new ContentWriteCutover(new SupabaseContentRepository(db), exporter), repo = cutover.repo;
    expect((await exporter.run()).exact).toBe(true);
    expect((await repo.createQueueIdea({ operationId: 'synthetic-unknown-edit', actor, libraryId: 'SYN-UNKNOWN-EDIT', sourcePlatform: 'X', currentHook: 'Synthetic', draftContent: 'Synthetic' })).ok).toBe(true);
    expect((await exporter.parity()).exact).toBe(true);
    const row = grid.findIndex(r => r.some(c => c.value === 'SYN-UNKNOWN-EDIT')) + 1;
    sheet.externalEdit(SHEET_TABS.queue.name, row, column, 'Synthetic hand edit');
    // Inspection alone must expose the conflict, before repair records it.
    const parity = await exporter.parity();
    expect(parity.exact).toBe(false);
    expect(parity.differences).toContainEqual(expect.objectContaining({ id: 'SYN-UNKNOWN-EDIT', fields: ['Synthetic extra'] }));
    await exporter.run();
    const report = await buildReconcileReport(repo, new FakeDriveGateway(), Date.now(), { contentCutover: cutover });
    expect(report.items.find(i => i.kind === 'export_parity')!.title).toBe('Sheet export parity is blocked');
    await expect(cutover.rollbackToSheet(vi.fn())).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(grid[row - 1]![column]!.value).toBe('Synthetic hand edit');
  });
  it('CS-059d: duplicate IDs create one lag item for the affected tab and recover after removal', async () => {
    const now = 1_800_000_000_000, { sheet, exporter, repo, cutover } = setup(() => now); await exporter.run();
    const grid = sheet.rawTab(SHEET_TABS.queue.name); grid.push(structuredClone(grid[1]!));
    await expect(exporter.run()).rejects.toMatchObject({ code: 'SCHEMA_DRIFT', details: { reason: 'duplicate_export_id' } });
    const report = await buildReconcileReport(repo, new FakeDriveGateway(), now + 3600_000, { contentCutover: cutover });
    expect(report.items.filter(i => i.kind === 'export_lag')).toHaveLength(1);
    expect(report.items.filter(i => i.title === 'Duplicate Sheet export IDs')).toHaveLength(1);
    grid.pop();
    expect((await exporter.run()).exact).toBe(true);
    expect(exporter.journal.issues.size).toBe(0);
  });
  it('CS-059d: an unknown Queue Posted column stays blank text on append', async () => {
    const { sheet, exporter, repo } = setup(); await exporter.run();
    const grid = sheet.rawTab(SHEET_TABS.queue.name), column = grid[0]!.length;
    grid[0]!.push({ value: 'Posted' });
    const append = vi.spyOn(sheet, 'appendRow');
    expect((await repo.createQueueIdea({ operationId: 'synthetic-posted-extra', actor, libraryId: 'SYN-POSTED-EXTRA', sourcePlatform: 'X', currentHook: 'Synthetic', draftContent: 'Synthetic' })).ok).toBe(true);
    expect(append.mock.calls[0]![2][column]).toBe('');
    expect(grid.at(-1)![column]!.value).toBe('');
  });
  it('distinguishes boolean checkbox bytes from identical formatted text in parity and the Ready Queue', async () => {
    const { sheet, exporter } = setup(); await exporter.run();
    const tab = SHEET_TABS.library.name, grid = sheet.rawTab(tab), col = grid[0]!.findIndex(c => c.value === 'Queue for Schedule');
    const row = grid.findIndex(r => r[col]?.value === 'TRUE');
    await sheet.writeCells(tab, [{ row: row + 1, column: col, value: 'TRUE' }]);
    const parity = await exporter.parity();
    expect(parity.exact).toBe(false); expect(parity.dbHash).not.toBe(parity.sheetHash);
    expect(parity.differences.some(d => d.fields.includes('Queue for Schedule'))).toBe(true);
    const ready = await sheet.readTab(SHEET_TABS.readyQueue.name, 'ZZ', { startRow: 1, maxRows: 100, formulas: true, links: true });
    expect(ready.some(r => r.values.includes(grid[row]![0]!.value))).toBe(false);
  });
  it('single-flights two repair exports racing on a not-yet-exported Replies row', async () => {
    const { db, sheet, exporter } = setup(); await exporter.run();
    expect((await new SupabaseContentRepository(db).createQueueIdea({ operationId: 'synthetic-race-insert', actor, libraryId: 'SYN-RACING-IDEA', sourcePlatform: 'X', currentHook: 'Synthetic', draftContent: 'Synthetic' })).ok).toBe(true);
    const grid = sheet.rawTab(SHEET_TABS.queue.name), before = grid.length;
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const append = sheet.appendRow.bind(sheet);
    const spy = vi.spyOn(sheet, 'appendRow').mockImplementation(async (...args) => { entered(); await gate; return append(...args); });
    const a = exporter.run(), b = exporter.run();
    try {
      await started;
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(spy).toHaveBeenCalledTimes(1); expect(grid).toHaveLength(before);
    } finally { release(); await Promise.allSettled([a, b]); }
    expect((await Promise.all([a, b])).every(r => r.exact)).toBe(true);
    expect(grid).toHaveLength(before + 1); expect(spy).toHaveBeenCalledTimes(1);
  });
  it('detects a real unexpected Sheet ID with differing hashes and blocks rollback', async () => {
    const { sheet, exporter, cutover } = setup(); await exporter.run();
    const grid = sheet.rawTab(SHEET_TABS.library.name), extra = structuredClone(grid[1]!);
    extra[grid[0]!.findIndex(c => c.value === 'Library ID')] = { value: 'SYN-EXTRA-SHEET-ID' }; grid.push(extra);
    const parity = await exporter.parity();
    expect(parity.exact).toBe(false); expect(parity.dbHash).not.toBe(parity.sheetHash);
    expect(parity.differences).toContainEqual(expect.objectContaining({ id: 'SYN-EXTRA-SHEET-ID', fields: ['@unexpected'] }));
    const flip = vi.fn(); await expect(cutover.rollbackToSheet(flip)).rejects.toMatchObject({ code: 'CONFLICT' }); expect(flip).not.toHaveBeenCalled();
  });
  it('never re-appends a deleted DB-origin Queue idea after its successful export', async () => {
    const { sheet, exporter, repo } = setup(); await exporter.run();
    expect((await repo.createQueueIdea({ operationId: 'synthetic-delete-insert', actor, libraryId: 'SYN-DELETED-IDEA', sourcePlatform: 'X', currentHook: 'Synthetic', draftContent: 'Synthetic' })).ok).toBe(true);
    const grid = sheet.rawTab(SHEET_TABS.queue.name), index = grid.findIndex(r => r.some(c => c.value === 'SYN-DELETED-IDEA'));
    expect(index).toBeGreaterThan(0); grid.splice(index, 1); const before = grid.length;
    expect((await exporter.run()).exact).toBe(false); expect(grid).toHaveLength(before);
    expect(exporter.journal.issues.get(exportKey('queue', 'SYN-DELETED-IDEA'))).toMatchObject({ reason: 'export_mismatch', fields: ['@missing'] });
  });
  it('refuses bounded-read exhaustion even when the truncated tail has no IDs', async () => {
    const { sheet, exporter } = setup(), read = sheet.readTab.bind(sheet);
    vi.spyOn(sheet, 'readTab').mockImplementation(async (...args) => {
      const rows = await read(...args);
      return args[0] === SHEET_TABS.library.name ? [...rows, ...Array.from({ length: MAX_TAB_ROWS - rows.length }, () => ({ values: [] }))] : rows;
    });
    await expect(exporter.parity()).rejects.toMatchObject({ code: 'SCHEMA_DRIFT', details: { reason: 'export_read_bound' } });
    expect(sheet.writes).toHaveLength(0);
  });
  it('records a read-back mismatch when a different cell changes during the write', async () => {
    const { sheet, repo, exporter } = setup(); await exporter.run();
    const grid = sheet.rawTab(SHEET_TABS.library.name), column = grid[0]!.findIndex(c => c.value === LIBRARY_HEADERS.currentHook);
    const checkpoint = exporter.journal.checkpoints.get(exportKey('library', 'SYN-L001'));
    sheet.beforeWrite = tab => { if (tab === SHEET_TABS.library.name) sheet.externalEdit(tab, 2, column, 'Synthetic racing hook'); };
    expect((await save(repo)).ok).toBe(true);
    expect(exporter.journal.issues.get(exportKey('library', 'SYN-L001'))).toMatchObject({ reason: 'export_mismatch', fields: ['Current Hook'] });
    expect(exporter.journal.checkpoints.get(exportKey('library', 'SYN-L001'))).toEqual(checkpoint);
  });
  it.each(['empty-header', 'link-only'] as const)('preserves a %s hand edit before an unrelated DB save', async variant => {
    const { sheet, exporter, repo } = setup(); await exporter.run();
    const grid = sheet.rawTab(SHEET_TABS.library.name), column = grid[0]!.findIndex(c => c.value === LIBRARY_HEADERS.sourceMarkdown);
    if (variant === 'empty-header') { grid[0]!.push({ value: '' }); grid[1]!.push({ value: 'Synthetic hidden hand edit' }); }
    else grid[1]![column]!.link = 'https://example.com/synthetic-link-edit';
    expect((await save(repo)).ok).toBe(true);
    expect(grid[1]!.find((_, i) => grid[0]![i]?.value === LIBRARY_HEADERS.draftContent)!.value).not.toBe('Synthetic DB save');
    expect(exporter.journal.issues.get(exportKey('library', 'SYN-L001'))!.reason).toBe('export_mismatch');
  });
  it('keeps mismatch field names and adds lag when subsequent provider reads fail', async () => {
    const now = 1_800_000_000_000, { sheet, repo, exporter, cutover } = setup(() => now); await exporter.run();
    sheet.externalEdit(SHEET_TABS.library.name, 2, sheet.rawTab(SHEET_TABS.library.name)[0]!.findIndex(c => c.value === LIBRARY_HEADERS.draftContent), 'Synthetic hand edit'); await exporter.run();
    sheet.failNext({ op: 'read', code: 'PROVIDER_UNAVAILABLE', times: 1000 });
    await expect(exporter.run()).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    expect(exporter.journal.issues.get(exportKey('library', 'SYN-L001'))).toMatchObject({ reason: 'export_mismatch', fields: ['Draft Content'], lagSince: now });
    const report = await buildReconcileReport(repo, new FakeDriveGateway(), now + 3600_000, { contentCutover: cutover });
    expect(report.items).toContainEqual(expect.objectContaining({ kind: 'export_mismatch', severity: 'blocking', facts: [expect.stringContaining('Draft Content')] }));
    expect(report.items).toContainEqual(expect.objectContaining({ kind: 'export_lag', severity: 'blocking', stableIds: ['SYN-L001'] }));
  });
  it('serializes read-only parity inspections and never lets reconcile page views add comparison samples', async () => {
    const { exporter, sheet, cutover, repo } = setup(); await exporter.run();
    const samples = exporter.journal.reports.length, reads = sheet.reads, writes = sheet.writes.length;
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
    const read = sheet.readTab.bind(sheet);
    const spy = vi.spyOn(sheet, 'readTab').mockImplementationOnce(async (...args) => { entered(); await gate; return read(...args); });
    const a = exporter.parity(), b = exporter.parity();
    try { await started; await new Promise<void>(resolve => setImmediate(resolve)); expect(spy).toHaveBeenCalledTimes(1); }
    finally { release(); await Promise.allSettled([a, b]); }
    expect(sheet.reads).toBe(reads + 8);
    await buildReconcileReport(repo, new FakeDriveGateway(), Date.now(), { contentCutover: cutover });
    expect(exporter.journal.reports).toHaveLength(samples); expect(sheet.writes).toHaveLength(writes);
  });
  it('shows a duplicate pasted Sheet ID as a blocking export item', async () => {
    const { sheet, repo, exporter, cutover } = setup(); await exporter.run();
    const grid = sheet.rawTab(SHEET_TABS.queue.name); grid.push(structuredClone(grid[1]!));
    const report = await buildReconcileReport(repo, new FakeDriveGateway(), Date.now(), { contentCutover: cutover });
    expect(report.items).toContainEqual(expect.objectContaining({ kind: 'export_mismatch', severity: 'blocking', title: 'Duplicate Sheet export IDs' }));
  });
  it('refuses DB text starting with equals as a named blocking field without writing it', async () => {
    const { sheet, repo, exporter, cutover } = setup(); await exporter.run(); const count = sheet.writes.length;
    expect((await save(repo, 'synthetic-formula-text', '=Synthetic text')).ok).toBe(true);
    expect(sheet.writes).toHaveLength(count);
    expect(exporter.journal.issues.get(exportKey('library', 'SYN-L001'))).toMatchObject({ reason: 'export_mismatch', fields: ['Draft Content'] });
    const report = await buildReconcileReport(repo, new FakeDriveGateway(), Date.now(), { contentCutover: cutover });
    expect(report.items.find(i => i.kind === 'export_mismatch' && i.stableIds.includes('SYN-L001'))!.facts.join(' ')).toContain('Change authoritative value');
    expect((await save(repo, 'synthetic-formula-recovery', 'Synthetic replacement')).ok).toBe(true);
    expect(exporter.journal.issues.has(exportKey('library', 'SYN-L001'))).toBe(false);
  });
  it('exports an approve-and-queue patch as real RAW checkboxes and updates the derived Ready Queue', async () => {
    const { repo, sheet, exporter } = setup(); await exporter.run();
    const row = await repo.getLibrary('SYN-L001');
    expect((await repo.updateLibrary({ operationId: 'synthetic-approve-queue', actor, target: { libraryId: 'SYN-L001' }, expectedRevision: row.revision,
      patch: { reviewStatus: 'Approved', queueForSchedule: 'TRUE' } })).ok).toBe(true);
    const column = sheet.rawTab(SHEET_TABS.library.name)[0]!.findIndex(c => c.value === 'Queue for Schedule');
    expect(sheet.writes.flatMap(w => w.tab === SHEET_TABS.library.name ? w.writes : []).find(w => w.column === column)?.value).toBe(true);
    expect((await sheet.readTab(SHEET_TABS.readyQueue.name, 'ZZ', { startRow: 1, maxRows: 100, formulas: true, links: true })).some(r => r.values.includes('SYN-L001'))).toBe(true);
    expect((await exporter.parity()).exact).toBe(true);
  });
  it('exports the Posted checkbox as a RAW boolean from an updated Schedule DB row', async () => {
    const { repo, sheet, exporter, db } = setup(); await exporter.run();
    const row = (await repo.listSchedule()).find(r => r.cells.posted === 'FALSE')!;
    // Posted is protected from ordinary repository patches; simulate the
    // authoritative database row change without weakening that allowlist.
    db.externalEdit('schedule', row.cells.contentId, { posted: true });
    expect((await exporter.run()).exact).toBe(true);
    const headers = sheet.rawTab(SHEET_TABS.schedule.name).find(r => r.some(c => c.value === 'Content ID'))!;
    const column = headers.findIndex(c => c.value === 'Posted');
    expect(sheet.writes.flatMap(w => w.tab === SHEET_TABS.schedule.name ? w.writes : []).find(w => w.column === column)!.value).toBe(true);
    expect((await exporter.parity()).exact).toBe(true);
  });
  it('exports a Replies idea immediately after save with a boolean checkbox, and refuses the insert during rollback', async () => {
    const { sheet, repo, exporter, cutover, db } = setup(); await exporter.run();
    const idea = { operationId: 'synthetic-reply-save', actor, libraryId: 'SYN-REPLY-NEW', sourcePlatform: 'X' as const, currentHook: 'Synthetic reply', draftContent: 'Synthetic idea' };
    expect((await repo.createQueueIdea(idea)).ok).toBe(true);
    const grid = sheet.rawTab(SHEET_TABS.queue.name), column = grid[0]!.findIndex(c => c.value === 'Queue for Schedule');
    expect(grid.some(r => r.some(c => c.value === idea.libraryId))).toBe(true);
    expect(sheet.writes.at(-1)!.writes.find(w => w.column === column)!.value).toBe(false);
    await cutover.rollbackToSheet(async () => {});
    expect(await repo.createQueueIdea({ ...idea, operationId: 'synthetic-reply-refused', libraryId: 'SYN-REPLY-REFUSED' })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(await db.getPost('queue', 'SYN-REPLY-REFUSED')).toBeNull();
  });
  it('ignores unowned unknown Queue columns on a new Replies idea but detects a lost imported unknown value', async () => {
    const seed = syntheticContentDbSeed(), sheet = new FakeSheetTransport(), grid = sheet.rawTab(SHEET_TABS.queue.name), column = grid[0]!.length;
    grid[0]!.push({ value: 'Synthetic extra' });
    for (const row of grid.slice(1)) row.push({ value: 'Synthetic retained value' });
    for (const row of seed.posts.filter(r => r.collection === 'queue')) {
      row.passthrough = { [column]: { header: 'Synthetic extra', value: 'Synthetic retained value', formula: 'Synthetic retained value', link: '' } };
      const raw = grid.find(r => r.some(c => c.value === row.library_id))!;
      row.sheet_revision = fingerprintValues([rowRevision(raw.map(c => c.value), column + 1), rowRevision(raw.map(c => c.formula ?? c.value), column + 1)]);
    }
    const db = new FakeContentDb(seed), exporter = new ContentExporter(db, sheet, { checkpoints: new Map(), issues: new Map(), reports: [] });
    const cutover = new ContentWriteCutover(new SupabaseContentRepository(db), exporter);
    expect((await exporter.run()).exact).toBe(true);
    expect((await cutover.repo.createQueueIdea({ operationId: 'synthetic-extra-idea', actor, libraryId: 'SYN-EXTRA-IDEA', sourcePlatform: 'X', currentHook: 'Synthetic', draftContent: 'Synthetic' })).ok).toBe(true);
    const parity = await exporter.run();
    expect(parity.differences).toEqual([]); expect(parity.dbHash).toBe(parity.sheetHash);
    expect((await cutover.rollbackToSheet(async () => {})).mode).toBe('sheet');
    const importedId = grid[1]![0]!.value;
    sheet.externalEdit(SHEET_TABS.queue.name, 2, column, '');
    expect((await exporter.run()).exact).toBe(false);
    expect(exporter.journal.issues.get(exportKey('queue', importedId))!.fields).toContain('Synthetic extra');
  });
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
  it('never recreates deleted imported rows; duplicate IDs fail closed', async () => {
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
  it('does not flip on a hand edit and leaves writes disabled', async () => {
    const { sheet, exporter, cutover, repo } = setup(); await exporter.run();
    sheet.externalEdit(SHEET_TABS.library.name, 2, Object.keys(LIBRARY_HEADERS).indexOf('draftContent'), 'Synthetic rollback conflict');
    const flip = vi.fn(); await expect(cutover.rollbackToSheet(flip)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(flip).not.toHaveBeenCalled(); expect((await save(repo)).ok).toBe(false);
  });
  it('does not flip when the Sheet is actually unreadable and refuses Replies inserts while draining rollback', async () => {
    const { sheet, exporter, cutover, repo } = setup(); await exporter.run();
    vi.spyOn(sheet, 'readTab').mockRejectedValue(new AppError('PROVIDER_UNAVAILABLE'));
    const flip = vi.fn(), rollback = cutover.rollbackToSheet(flip);
    const idea = { operationId: 'synthetic-rollback-idea', actor, libraryId: 'SYN-ROLLBACK-IDEA', sourcePlatform: 'X' as const, currentHook: 'Synthetic', draftContent: 'Synthetic' };
    const refusal = repo.createQueueIdea(idea);
    await expect(rollback).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    expect(await refusal).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(flip).not.toHaveBeenCalled(); expect(repo.capability().state).toBe('read_only');
    expect(await repo.createQueueIdea({ ...idea, operationId: 'synthetic-after-rollback' })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });
  it('counts distinct committed mutations once, excluding replays and no-op saves', async () => {
    const { repo, cutover, db } = setup();
    // A replay can first reach this cutover instance after another instance
    // committed it; its local Set alone cannot deduplicate that delivery.
    expect((await save(new SupabaseContentRepository(db), 'synthetic-elsewhere', 'Synthetic preceding save')).ok).toBe(true);
    expect(await save(repo, 'synthetic-elsewhere', 'Synthetic preceding save')).toMatchObject({ ok: true, replayed: true });
    expect(cutover.mutationCount).toBe(0);
    expect((await save(repo)).ok).toBe(true); expect(cutover.mutationCount).toBe(1);
    expect(await save(repo)).toMatchObject({ ok: true, replayed: true }); expect(cutover.mutationCount).toBe(1);
    expect((await save(repo, 'synthetic-no-op-save')).ok).toBe(true); expect(cutover.mutationCount).toBe(1);
  });
  it('backup freshness has a 36-hour boundary and reports a failed newer backup even when the last is fresh', async () => {
    const now = 1_800_000_000_000, { repo, cutover } = setup(() => now);
    const last = await createContentBackup({ snapshot: async () => emptyBackupSnapshot() }, new FakePrivateBackupFolder(), { lastVerified: null, failureSince: null }, now);
    for (const [age, failureSince, expected] of [[36 * 3600_000, null, false], [36 * 3600_000 + 1, null, true], [0, now, true]] as const) {
      const report = await buildReconcileReport(repo, new FakeDriveGateway(), now + age, { contentCutover: cutover, backupJournal: { lastVerified: last, failureSince } });
      expect(report.items.some(i => i.kind === 'backup_fresh')).toBe(expected);
    }
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
    const samples = exporter.lagSamples.splice(0);
    exporter.lagSamples.push(...samples.filter(s => s.at !== Date.parse('2026-10-08T04:00:00Z')));
    expect(exporter.comparison(now, 50).ready).toBe(false);
    exporter.lagSamples.splice(0, exporter.lagSamples.length, ...samples);
    expect(exporter.comparison(now + 86400_000, 50).ready).toBe(false);
    exporter.lagSamples.push({ at: now - 86400_000, lagMs: 900_001 });
    expect(exporter.comparison(now, 50).ready).toBe(false);
    exporter.lagSamples.pop(); exporter.repairedFailures.push({ since: now - 28 * 3600_000, repairedAt: now - 26 * 3600_000 });
    expect(exporter.comparison(now, 50).ready).toBe(false);
  });
});

it('CS-059j: equals-only refusal gives value recovery without unrelated direction advice', async () => {
  const { exporter, repo, cutover } = setup(); await exporter.run();
  await save(repo, 'synthetic_equals_only', '=Synthetic literal');
  const report = await buildReconcileReport(repo, new FakeDriveGateway(), Date.now(), { contentCutover: cutover });
  const facts = report.items.find(i => i.kind === 'export_mismatch' && i.stableIds.includes('SYN-L001'))!.facts.join(' ');
  expect(facts).toContain('Change authoritative value');
  expect(facts).not.toContain('Review the direction');
});
