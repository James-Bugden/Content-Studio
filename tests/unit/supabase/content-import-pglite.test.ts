import { readFileSync, readdirSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../replies/support/db';
import { buildTypedImport, type ImportEnvelope } from '@/application/content-import';
import { buildSheetMirrorSnapshot, mirrorHash } from '@/application/sheet-mirror';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';
import { FakeSheetTransport } from '@/integrations/google/fake-sheet';
import { FakeContentDb } from '@/integrations/supabase/fake-content-db';
import type { ContentPostRow, ContentScheduleRow, ContentSettingRow } from '@/application/content-db';
import { getServices, resetServices } from '@/application/container';
import { resetEnvCache } from '@/lib/env';
import { runConfiguredSheetMirror } from '@/lib/sheet-mirror-operation';
import { CONTENT_ANGLE_RAW_KEY } from '@/domain/content-angle';
import { LIBRARY_HEADERS, SCHEDULE_HEADERS, SHEET_TABS } from '@/domain/sheet-schema';
import { SupabaseContentRepository } from '@/integrations/supabase/content-repository';
import { ContentExporter, ContentWriteCutover, contentExportRows } from '@/application/content-export';
import { compareContent } from '@/application/content-parity';
import { AppError } from '@/domain/errors';

beforeEach(async () => {
  vi.stubEnv('CS_CONTENT_STORE', 'db-shadow');
  await db.raw.exec('truncate content_studio_shadow_jobs, content_studio_shadow_lease, content_studio_shadow_events, content_studio_posts, content_studio_schedule, content_studio_workflow_settings, content_studio_operations, content_studio_import_runs, content_studio_audit_events, content_studio_row_history restart identity cascade');
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); resetServices(); resetEnvCache(); });
let db: TestDatabase;
const actor = mirrorHash('synthetic-import');
const rpc = (e: ImportEnvelope) => db.asService(q => q.query<{ result: { ok: boolean } }>('select public.content_studio_import_run($1,$2,$3,$4,$5,$6,$7) as result',
  [e.operationId, e.snapshotHash, e.actorHash, e.counts, e.hashes, e.exceptions, e.rows]));
beforeAll(async () => {
  db = await createTestDatabase();
  // Include future Content migrations: a later RPC redefinition must preserve
  // every representation accepted by the complete import chain.
  for (const migration of readdirSync('supabase/migrations').filter(f => /^\d+_content_.*\.sql$/.test(f)).sort()) await db.raw.exec(readFileSync(`supabase/migrations/${migration}`, 'utf8'));
}, 120_000);
afterAll(async () => { await db?.close(); });

describe('MIG-09 actual DB-1 import RPC with DB-4 envelopes', () => {
  it('CS-075: schedule instants, empty Ready sentinel and absent summary match actual SQL views', async () => {
    const sourceNames = ['Mixed', 'Mixed', 'Mixed', 'Mixed', 'Mixed', 'Mixed', 'Mixed', 'Mixed', 'Fallback', 'Fallback', 'Blank links', 'Cafe\u0301', 'Caf\u00e9', '\uFF21', 'A\t', 'A', '', ' ', ' A '];
    const statuses = ['', 'Not Reviewed', 'Pending', 'Approved', 'Changes Requested', 'Skipped', 'Approved ', 'pending'];
    const headers = Object.keys(LIBRARY_HEADERS);
    const queue = sourceNames.map((source, i) => {
      const values: Record<string, string> = { libraryId: `SYN-SUM-${i}`, contentSource: source,
        reviewStatus: statuses[i % statuses.length]!, queueForSchedule: i % 2 ? 'yes' : 'FALSE',
        copyrightQa: i === 4 || i === 5 ? 'REWORK' : '', duplicateQa: i === 4 || i === 6 ? 'CHECK' : i === 7 ? 'DUPLICATE' : '',
        sourceMasterFile: i < 2 ? 'Open master' : '', sourceMarkdown: i < 10 ? 'Open markdown' : '' };
      return { values: headers.map(field => values[field] ?? ''), links: headers.map(field => field === 'sourceMasterFile' && i < 2
        ? `https://synthetic.example/${i === 0 ? '\u{10000}' : '\uE000'}`
        : field === 'sourceMarkdown' && i < 10 ? `https://synthetic.example/md-${10 - i}` : '') };
    });
    // An unfinished queue row and a Library-only source cannot enter the queue view.
    queue.push({ values: headers.map(field => field === 'libraryId' ? ' ' : field === 'contentSource' ? 'Excluded' : ''), links: [] });
    const transport = new FakeSheetTransport({ [SHEET_TABS.queue.name]: [{ values: Object.values(LIBRARY_HEADERS) }, ...queue],
      [SHEET_TABS.readyQueue.name]: [{ values: Object.values(LIBRARY_HEADERS) }, { values: ['No posts queued'] }] });
    const read = transport.readTab.bind(transport);
    let absent = true;
    vi.spyOn(transport, 'readTab').mockImplementation((tab, column, options) => {
      if (tab === SHEET_TABS.queueSummary.name && absent) throw new AppError('VALIDATION_FAILED');
      return read(tab, column, options);
    });
    const sheet = new SheetsContentRepository(transport);
    const library = transport.rawTab(SHEET_TABS.library.name), queueColumn = library[0]!.findIndex(c => c.value === LIBRARY_HEADERS.queueForSchedule);
    library.slice(1).forEach(row => { row[queueColumn] = { value: 'FALSE' }; });
    const schedule = transport.rawTab(SHEET_TABS.schedule.name), stampColumn = schedule[1]!.findIndex(c => c.value === SCHEDULE_HEADERS.finalSyncedAt);
    const stamps = ['2026-09-21T02:59:52.000Z #synthetic-hash', '2026-09-20T22:59:52.1200-04:00', '2026-09-21T10:59:52.123456+08:00'];
    stamps.forEach((text, i) => { schedule[i + 2]![stampColumn] = { value: text }; });
    const snapshot = await buildSheetMirrorSnapshot(sheet, { sourceKey: 'synthetic_workbook' });
    expect(snapshot.counts.ready).toBe(0);
    const envelope = buildTypedImport(snapshot, new Map(), actor);
    expect(envelope.rows.some(r => r.target_id === 'No posts queued')).toBe(false);
    expect((await rpc(envelope)).rows[0]!.result.ok).toBe(true);
    const query = async <T>(sql: string): Promise<T[]> => JSON.parse(JSON.stringify((await db.asService(q => q.query<T>(sql))).rows));
    const reader = new FakeContentDb({ posts: await query<ContentPostRow>('select * from content_studio_posts'),
      schedule: await query<ContentScheduleRow>("select *, to_char(final_synced_at at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') as final_synced_at from content_studio_schedule"), settings: [] });
    // These two reads use the real SQL views, not the fake's summary implementation.
    vi.spyOn(reader, 'queueSummary').mockImplementation(() => query('select * from content_studio_queue_summary order by content_source collate "C"'));
    const listPosts = reader.listPosts.bind(reader);
    vi.spyOn(reader, 'listPosts').mockImplementation(collection => collection === 'ready'
      ? query('select * from content_studio_ready_queue') : listPosts(collection));
    const repo = new SupabaseContentRepository(reader);
    expect(await repo.listReadyQueue()).toEqual([]);
    expect(compareContent('ready', await sheet.listReadyQueue(), await repo.listReadyQueue(), 100, 0)).toMatchObject({ idsEqual: true, blocking: 0, fields: 0 });
    const expectedSummary = await sheet.queueSummary(), actualSummary = await repo.queueSummary();
    expect(expectedSummary).toEqual(actualSummary);
    expect(expectedSummary.find(r => r.source === 'Mixed')).toEqual({ source: 'Mixed', masterLink: 'https://synthetic.example/\uE000',
      counts: { Total: 8, 'Not Reviewed': 3, Approved: 1, Queued: 4, 'Needs Fix': 3 } });
    expect(expectedSummary.some(r => r.source === 'Excluded')).toBe(false);
    expect(expectedSummary.find(r => r.source === 'Fallback')?.masterLink).toBe('https://synthetic.example/md-1');
    expect(expectedSummary.find(r => r.source === 'Blank links')?.masterLink).toBe('');
    expect(compareContent('queue_summary', expectedSummary, actualSummary, 100, 0)).toMatchObject({ idsEqual: true, blocking: 0, facts: [] });
    const expectedSchedule = await sheet.listSchedule(), actualSchedule = await repo.listSchedule();
    const equal = compareContent('schedule', expectedSchedule, actualSchedule, 100, 0);
    expect(equal.blocking).toBe(0); expect(equal.equal).toBe(equal.fields);
    expect(equal.facts).toEqual([]); // The original timestamp text now survives SQL normalization.
    actualSchedule[0]!.cells.finalSyncedAt = actualSchedule[0]!.value.finalSyncedAt = '2026-09-21T02:59:53Z #synthetic-hash';
    expect(compareContent('schedule', expectedSchedule, actualSchedule, 100, 0).blocking).toBe(2);
    actualSummary[0]!.counts.Total!++;
    expect(compareContent('queue_summary', expectedSummary, actualSummary, 100, 0).blocking).toBe(1);
    // A present empty tab remains evidence of a real mismatch, not a fallback.
    absent = false; transport.rawTab(SHEET_TABS.queueSummary.name).splice(0);
    expect(await sheet.queueSummary()).toEqual([]);
    expect(compareContent('queue_summary', await sheet.queueSummary(), await repo.queueSummary(), 100, 0).idsEqual).toBe(false);
  });
  it.each((['library', 'queue'] as const).flatMap(kind => [
    { kind, text: ' \t3. Example angle \u81fa  ', angle: 3, changed: '3. Example angle \u81fa' },
    { kind, text: '7. Cafe\u0301', angle: 7, changed: '7. Caf\u00e9' },
    { kind, text: '7. exact\t', angle: 7, changed: '7. exact' },
  ]))('CS-072: $kind/$text label/plain cells survive SQL measurement, export and exact rollback', async ({ kind, text, angle, changed }) => {
    const transport = new FakeSheetTransport(), sheet = new SheetsContentRepository(transport);
    const tab = SHEET_TABS[kind].name, grid = transport.rawTab(tab);
    const column = grid[0]!.findIndex(c => c.value === LIBRARY_HEADERS.contentAngle);
    transport.externalEdit(tab, 2, column, text);
    transport.externalEdit(tab, 3, column, '14');
    grid[0]!.push({ value: 'Synthetic extra' }); grid[1]!.push({ value: 'Synthetic extra value  ' });
    const e = buildTypedImport(await buildSheetMirrorSnapshot(sheet, { sourceKey: 'synthetic_workbook' }), new Map(), actor);
    const operation = 'owner:synthetic_source:11111111-1111-4111-8111-111111111111';
    const token = '22222222-2222-4222-8222-222222222222';
    e.operationId = operation;
    // PostgREST returns JSON timestamps; PGlite's direct driver returns Dates.
    const query = async <T>(sql: string, params: unknown[] = []): Promise<T[]> => JSON.parse(JSON.stringify((await db.asService(q => q.query<T>(sql, params))).rows));
    await query('select content_studio_shadow_claim($1,$2,$3)', [operation, e.snapshotHash, token]);
    await query('select content_studio_shadow_import($1,$2,$3,$4,$5,$6,$7,$8)', [operation, token, e.snapshotHash, e.actorHash, e.counts, e.hashes, e.exceptions, e.rows]);
    const evidence = (await query<{ result: { fullParity: { idsEqual: boolean; rows: number; fields: number; equal: number; unclassified: number }; exceptions: { class: string }[] } }>('select result from content_studio_shadow_jobs where operation_id=$1', [operation]))[0]!.result;
    expect(evidence.exceptions.filter(e => e.class.startsWith('refused_'))).toEqual([]);
    expect(evidence.fullParity).toMatchObject({ rows: e.rows.length, idsEqual: true, unclassified: 0 });
    expect(evidence.fullParity.equal).toBe(evidence.fullParity.fields);
    const posts = await query<ContentPostRow>('select * from content_studio_posts');
    const schedule = await query<ContentScheduleRow>('select * from content_studio_schedule');
    const settings = await query<ContentSettingRow>('select * from content_studio_workflow_settings');
    const sources = await (kind === 'library' ? sheet.listLibrary() : sheet.listQueue());
    const source = sources[0]!;
    const stored = posts.find(r => r.collection === kind && r.library_id === source.value.libraryId)!;
    expect(stored).toMatchObject({ content_angle: angle, passthrough: { [CONTENT_ANGLE_RAW_KEY]: text } });
    expect(Buffer.from(stored.passthrough[CONTENT_ANGLE_RAW_KEY] as string)).toEqual(Buffer.from(text));
    expect(posts.find(r => r.collection === kind && r.library_id === sources[1]!.value.libraryId)?.content_angle).toBe(14);
    const reader = new FakeContentDb({ posts, schedule, settings });
    const repo = new SupabaseContentRepository(reader), exporter = new ContentExporter(reader, transport, { checkpoints: new Map(), issues: new Map(), reports: [] });
    for (const [collection, method] of [['library', 'listLibrary'], ['queue', 'listQueue'], ['ready', 'listReadyQueue'], ['schedule', 'listSchedule'], ['queue_summary', 'queueSummary'], ['workflow_settings', 'workflowSettings']] as const) {
      expect(compareContent(collection, await sheet[method](), await repo[method](), 1, 0)).toMatchObject({ idsEqual: true, blocking: 0, facts: [] });
    }
    const method = kind === 'library' ? 'listLibrary' : 'listQueue';
    const actual = await repo[method]();
    expect(Buffer.from(actual[0]!.cells.contentAngle!)).toEqual(Buffer.from(text));
    actual[0]!.cells.contentAngle = changed;
    const mismatch = compareContent(kind, sources, actual, 1, 0);
    expect(mismatch.blocking).toBeGreaterThan(0);
    expect(mismatch.facts).toContainEqual(expect.objectContaining({ field: 'cells.contentAngle', kind: 'changed' }));
    const exported = (await contentExportRows(reader)).find(r => r.kind === kind && r.id === source.value.libraryId)!;
    expect(Buffer.from(exported.cells[LIBRARY_HEADERS.contentAngle]!.value)).toEqual(Buffer.from(text));
    expect(exported.cells['Synthetic extra']).toEqual({ value: 'Synthetic extra value  ' });
    const before = grid.map(row => row[column]?.value ?? '');
    const rollback = await new ContentWriteCutover(repo, exporter).rollbackToSheet(vi.fn());
    expect(rollback.parity).toMatchObject({ exact: true, dbHash: rollback.parity.sheetHash });
    expect(Buffer.from(JSON.stringify(grid.map(row => row[column]?.value ?? '')))).toEqual(Buffer.from(JSON.stringify(before)));
    // Exercise a changed integer through the real SQL copy/CAS boundary.
    const original = e.rows.find(r => r.target_kind === kind && r.target_id === source.value.libraryId)!;
    const result = await query<{ r: { ok: boolean } }>('select content_studio_write_through($1,$2,$3,$4,$5,$6,$7) as r', ['synthetic-angle-edit', mirrorHash('synthetic-angle-edit'), actor, kind, source.value.libraryId, stored.row_version, { ...original.row, content_angle: 4 }]);
    expect(result[0]!.r.ok).toBe(true);
    const edited = (await query<ContentPostRow>('select * from content_studio_posts where collection=$1 and library_id=$2', [kind, source.value.libraryId]))[0]!;
    reader.externalEdit(kind, source.value.libraryId, edited);
    expect((await exporter.run()).exact).toBe(true);
    expect(grid[1]![column]!.value).toBe('4');
  });
  it('CS-072: refused labels stay out of SQL while other rows and a content-free refusal ledger commit', async () => {
    const transport = new FakeSheetTransport(), sheet = new SheetsContentRepository(transport);
    const grid = transport.rawTab(SHEET_TABS.library.name);
    const column = grid[0]!.findIndex(c => c.value === LIBRARY_HEADERS.contentAngle);
    const invalid = ['0. Example angle', '15. Example angle', 'x. y', '7 Example angle'];
    invalid.forEach((text, i) => transport.externalEdit(SHEET_TABS.library.name, i + 2, column, text));
    const sources = await sheet.listLibrary();
    const e = buildTypedImport(await buildSheetMirrorSnapshot(sheet, { sourceKey: 'synthetic_workbook' }), new Map(), actor);
    expect(e.counts.library).toBe(sources.length - invalid.length);
    expect(e.exceptions.filter(e => e.class === 'refused_numeric')).toHaveLength(invalid.length);
    expect((await rpc(e)).rows[0]!.result.ok).toBe(true);
    const rows = await db.asService(q => q.query<{ library_id: string }>("select library_id from content_studio_posts where collection='library'"));
    for (const source of sources.slice(0, invalid.length)) expect(rows.rows.some(r => r.library_id === source.value.libraryId)).toBe(false);
    const ledger = await db.asService(q => q.query<{ exceptions: unknown }>('select exceptions from content_studio_import_runs where operation_id=$1', [e.operationId]));
    expect(ledger.rows[0]!.exceptions).toEqual(e.exceptions);
    for (const text of invalid) expect(JSON.stringify(ledger.rows[0])).not.toContain(text);
  });
  it.each((['library', 'queue'] as const).flatMap(kind => ['\uFF17. x', '\u0667. x'].map(text => ({ kind, text }))))('CS-072: $kind/$text non-ASCII digits are refused with a SQL ledger entry', async ({ kind, text }) => {
    const transport = new FakeSheetTransport(), sheet = new SheetsContentRepository(transport);
    const tab = SHEET_TABS[kind].name, grid = transport.rawTab(tab);
    const column = grid[0]!.findIndex(c => c.value === LIBRARY_HEADERS.contentAngle);
    transport.externalEdit(tab, 2, column, text);
    const sources = await (kind === 'library' ? sheet.listLibrary() : sheet.listQueue());
    const e = buildTypedImport(await buildSheetMirrorSnapshot(sheet, { sourceKey: 'synthetic_workbook' }), new Map(), actor);
    expect(e.counts[kind]).toBe(sources.length - 1);
    const refusal = { class: 'refused_numeric', collection: kind, field: 'content_angle', hash: expect.stringMatching(/^[a-f0-9]{64}$/) };
    expect(e.exceptions.filter(e => e.class.startsWith('refused_'))).toEqual([refusal]);
    expect((await rpc(e)).rows[0]!.result.ok).toBe(true);
    const rows = await db.asService(q => q.query('select library_id from content_studio_posts where collection=$1 and library_id=$2', [kind, sources[0]!.value.libraryId]));
    expect(rows.rows).toEqual([]);
    const ledger = await db.asService(q => q.query<{ exceptions: ImportEnvelope['exceptions'] }>('select exceptions from content_studio_import_runs where operation_id=$1', [e.operationId]));
    expect(ledger.rows[0]!.exceptions.filter(e => e.class.startsWith('refused_'))).toEqual([refusal]);
    expect(JSON.stringify(ledger.rows[0])).not.toContain(text);
  });
  it.each(['formula_display', 'number_formatting', 'trailing_whitespace', 'blank_boolean', 'boolean_formatting', 'timestamp_formatting'])('the complete migration chain still accepts %s', async kind => {
    const snapshot = await buildSheetMirrorSnapshot(new SheetsContentRepository(new FakeSheetTransport()), { sourceKey: 'synthetic_workbook' });
    const e = buildTypedImport(snapshot, new Map(), actor);
    e.exceptions = [{ class: kind as ImportEnvelope['exceptions'][number]['class'], collection: 'schedule', field: 'posted', hash: mirrorHash(kind) }];
    e.snapshotHash = mirrorHash({ counts: e.counts, hashes: e.hashes, exceptions: e.exceptions, rows: e.rows });
    expect((await rpc(e)).rows[0]!.result.ok).toBe(true);
  });
  it('SQL accepts the named real-workbook representations and persists their ledger', async () => {
    const snapshot = await buildSheetMirrorSnapshot(new SheetsContentRepository(new FakeSheetTransport()), { sourceKey: 'synthetic_workbook' });
    const row = snapshot.rows.find(r => r.collection === 'schedule')!;
    Object.assign((row.payload as { cells: Record<string, string> }).cells, { views: '007', posted: '', publishedAt: '2026-10-01T00:00:00Z' });
    row.rowHash = mirrorHash(row.payload);
    const library = snapshot.rows.find(r => r.collection === 'library')!;
    (library.payload as { cells: Record<string, string> }).cells.queueForSchedule = 'yes';
    library.rowHash = mirrorHash(library.payload);
    const e = buildTypedImport(snapshot, new Map(), actor);
    expect(e.exceptions).toEqual(expect.arrayContaining(['number_formatting', 'blank_boolean', 'boolean_formatting', 'timestamp_formatting'].map(kind => expect.objectContaining({ class: kind }))));
    expect((await rpc(e)).rows[0]!.result.ok).toBe(true);
    const stored = await db.asService(q => q.query<{ posted: boolean; views: number; published_at: Date }>('select posted,views,published_at from content_studio_schedule where content_id=$1', [row.stableId]));
    expect(stored.rows[0]).toMatchObject({ posted: false, views: 7 });
    expect(Date.parse(String(stored.rows[0]!.published_at))).toBe(Date.parse('2026-10-01T00:00:00Z'));
    const ledger = await db.asService(q => q.query<{ exceptions: unknown }>('select exceptions from content_studio_import_runs where operation_id=$1', [e.operationId]));
    expect(ledger.rows[0]!.exceptions).toEqual(e.exceptions);
  });
  it('scheduled reruns capture fresh SQL versions, preserve no-op/metadata versions, and reject a raced version atomically', async () => {
    vi.stubEnv('CS_DATA_MODE', 'fake'); resetServices(); resetEnvCache();
    const services = getServices(), reader = new FakeContentDb({ posts: [], schedule: [], settings: [] });
    const query = async <T>(sql: string, params?: unknown[]) => (await db.asService(q => q.query<T>(sql, params))).rows;
    vi.spyOn(reader, 'schemaVersion').mockImplementation(async () => (await query<{ version: number }>('select version from content_studio_schema_version'))[0]!.version);
    vi.spyOn(reader, 'listPosts').mockImplementation(c => query<ContentPostRow>('select * from content_studio_posts where collection=$1', [c]));
    vi.spyOn(reader, 'listSchedule').mockImplementation(() => query<ContentScheduleRow>('select * from content_studio_schedule'));
    vi.spyOn(reader, 'workflowSettings').mockImplementation(() => query<ContentSettingRow>('select * from content_studio_workflow_settings'));
    const envelopes: ImportEnvelope[] = [];
    services.contentImport = { db: reader, applyImport: async e => { envelopes.push(e); expect((await rpc(e)).rows[0]!.result.ok).toBe(true); } };
    // Read the Sheet directly here: shadow sampling is independently tested.
    services.repo = new SheetsContentRepository(new FakeSheetTransport());
    const first = await runConfiguredSheetMirror({ kind: 'scheduled' });
    const originals = await services.repo.listLibrary(), id = originals[0]!.value.libraryId;
    const state = async () => (await query<{ row_version: number; sheet_revision: string; draft_content: string }>('select row_version,sheet_revision,draft_content from content_studio_posts where collection=$1 and library_id=$2', ['library', id]))[0]!;
    const history = async () => Number((await query<{ n: number }>('select count(*)::integer as n from content_studio_row_history'))[0]!.n);
    const start = await state(), initialHistory = await history();
    const second = await runConfiguredSheetMirror({ kind: 'scheduled' });
    expect(second.runId).not.toBe(first.runId);
    expect(envelopes[1]!.operationId).not.toBe(envelopes[0]!.operationId);
    expect(envelopes[0]!.rows.find(r => r.target_id === id)?.expected_version).toBe(null);
    expect(envelopes[1]!.rows.find(r => r.target_id === id)?.expected_version).toBe(1);
    expect(await state()).toEqual(start); expect(await history()).toBe(initialHistory);

    const changed = structuredClone(originals); changed[0]!.revision = 'abcdefabcdefabcd';
    vi.spyOn(services.repo, 'listLibrary').mockResolvedValue(changed);
    await runConfiguredSheetMirror({ kind: 'scheduled' });
    expect(await state()).toEqual({ ...start, sheet_revision: 'abcdefabcdefabcd' });
    expect(await history()).toBe(initialHistory);
    expect(await query('select outcome,changed_fields from content_studio_audit_events where operation_id=$1 and target_kind=$2 and target_id=$3',
      [envelopes.at(-1)!.operationId, 'library', id])).toEqual([{ outcome: 'applied', changed_fields: ['sheet_revision'] }]);
    const patch = async (op: string, version: number, text: string) => query<{ result: { ok: boolean; code: string } }>('select content_studio_apply_patch($1,$2,$3,$4,$5,$6,$7) as result', [op, mirrorHash([op, text]), actor, 'library', id, version, { draft_content: text }]);
    expect((await patch('synthetic-external-1', 1, 'Synthetic external edit'))[0]!.result.ok).toBe(true);
    await runConfiguredSheetMirror({ kind: 'scheduled' });
    expect(envelopes.at(-1)!.rows.find(r => r.target_id === id)?.expected_version).toBe(2);
    expect((await state()).row_version).toBe(3);
    // Capture version=3, then change SQL while the importer reads the Sheet.
    vi.spyOn(services.repo, 'listLibrary').mockImplementationOnce(async () => {
      expect((await patch('synthetic-race-1', 3, 'Synthetic concurrent edit'))[0]!.result.ok).toBe(true);
      return changed;
    });
    const runsBefore = await query('select operation_id from content_studio_import_runs order by operation_id');
    await expect(runConfiguredSheetMirror({ kind: 'scheduled' })).rejects.toMatchObject({ code: '40001' });
    expect(envelopes.at(-1)!.rows.find(r => r.target_id === id)?.expected_version).toBe(3);
    expect((await state()).row_version).toBe(4);
    expect((await state()).draft_content).toBe('Synthetic concurrent edit');
    expect(await query('select operation_id from content_studio_import_runs order by operation_id')).toEqual(runsBefore);
    // The underlying compare-and-set result explicitly identifies STALE_READ.
    expect((await patch('synthetic-stale-probe', 3, 'Synthetic refused edit'))[0]!.result).toMatchObject({ ok: false, code: 'STALE_READ' });
  });
  it('imports every typed synthetic field exactly, replays, and rolls back an invalid late row with history/ledger', async () => {
    const sheet = new SheetsContentRepository(new FakeSheetTransport());
    const e = buildTypedImport(await buildSheetMirrorSnapshot(sheet, { sourceKey: 'synthetic_workbook' }), new Map(), actor);
    expect((await rpc(e)).rows[0]?.result.ok).toBe(true);
    const table = { library: 'posts', queue: 'posts', schedule: 'schedule', workflow_settings: 'workflow_settings' };
    for (const r of e.rows) {
      const key = r.target_kind === 'schedule' ? 'content_id' : r.target_kind === 'workflow_settings' ? 'setting' : 'library_id';
      const { rows } = await db.asService(q => q.query<Record<string, unknown>>(`select * from public.content_studio_${table[r.target_kind]} where ${key}=$1${key === 'library_id' ? ' and collection=$2' : ''}`, key === 'library_id' ? [r.target_id, r.target_kind] : [r.target_id]));
      const actual = rows[0]!;
      for (const [k, v] of Object.entries(r.row)) {
        if (k.endsWith('_at') && typeof v === 'string') expect(Date.parse(String(actual[k]))).toBe(Date.parse(v));
        else expect(actual[k], `${r.target_kind}.${k}`).toEqual(v);
      }
    }
    const counts = async () => (await db.asService(q => q.query('select (select count(*) from public.content_studio_row_history) as history,(select count(*) from public.content_studio_operations) as operations,(select count(*) from public.content_studio_import_runs) as runs'))).rows;
    const before = await counts();
    expect((await rpc(e)).rows[0]?.result.ok).toBe(true);
    expect(await counts()).toEqual(before);
    const broken = structuredClone(e); broken.operationId = 'synthetic-failed-import';
    broken.rows[0]!.row.draft_content = 'Synthetic rolled back';
    for (const r of broken.rows) r.expected_version = 1;
    broken.rows.at(-1)!.row.not_a_column = 'synthetic';
    broken.snapshotHash = mirrorHash({ counts: broken.counts, hashes: broken.hashes, exceptions: broken.exceptions, rows: broken.rows });
    await expect(rpc(broken)).rejects.toThrow();
    expect(await counts()).toEqual(before);
    expect((await db.asService(q => q.query("select count(*) as n from public.content_studio_posts where draft_content='Synthetic rolled back'"))).rows[0]).toEqual({ n: 0 });
  });
});
