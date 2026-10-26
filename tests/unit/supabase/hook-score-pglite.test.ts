import { readFileSync, readdirSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../replies/support/db';
import { buildTypedImport, type ImportEnvelope } from '@/application/content-import';
import { buildSheetMirrorSnapshot, mirrorHash } from '@/application/sheet-mirror';
import { FakeContentDb } from '@/integrations/supabase/fake-content-db';
import type { ContentPostRow, ContentScheduleRow, ContentSettingRow } from '@/application/content-db';
import { SupabaseContentRepository } from '@/integrations/supabase/content-repository';
import { HOOK_SCORE_RAW_KEY } from '@/domain/hook-score';
import { ContentExporter, ContentWriteCutover, contentExportRows } from '@/application/content-export';
import { compareContent } from '@/application/content-parity';
import { LIBRARY_HEADERS } from '@/domain/sheet-schema';
import { acceptedScores, refusedScores, scoreFixture, scoreKinds, scoreMethod } from '../../support/hook-score';

const migration = '20261026000100_content_hook_score_decimal.sql';
let db: TestDatabase;
const actor = mirrorHash('synthetic-score-sql');
const query = async <T>(sql: string, params: unknown[] = []): Promise<T[]> => (await db.asService(q => q.query<T>(sql, params))).rows;
const rpc = (e: ImportEnvelope) => query<{ r: { ok: boolean } }>('select content_studio_import_run($1,$2,$3,$4,$5,$6,$7) as r', [e.operationId, e.snapshotHash, actor, e.counts, e.hashes, e.exceptions, e.rows]);
beforeAll(async () => {
  db = await createTestDatabase();
  for (const file of readdirSync('supabase/migrations').filter(f => /^\d+_content_.*\.sql$/.test(f)).sort()) {
    if (file === migration) {
      // Upgrade a populated deployment; preserve legacy values, versions and metadata.
      await query("insert into content_studio_posts(collection,library_id,hook_score,row_version,passthrough) values('library','SYN-legacy',7,4,'{\"synthetic\":\"Café\\t\"}')");
      await query("insert into content_studio_schedule(content_id,hook_score,row_version) values('SYN-legacy',-7,3)");
      await db.raw.exec('alter default privileges in schema public grant all on tables to anon,authenticated');
    }
    await db.raw.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'));
  }
}, 120_000);
afterAll(async () => { await db?.close(); });
beforeEach(() => vi.stubEnv('CS_CONTENT_STORE', 'db-shadow'));
afterEach(() => vi.unstubAllEnvs());
async function reset() {
  await db.raw.exec('truncate content_studio_posts,content_studio_schedule,content_studio_workflow_settings,content_studio_operations,content_studio_import_runs,content_studio_audit_events,content_studio_row_history,content_studio_shadow_jobs,content_studio_shadow_lease,content_studio_shadow_events restart identity cascade');
}
async function reader() {
  const rows = async <T>(table: string) => (await query<{ r: T }>(`select to_jsonb(t) as r from ${table} t`)).map(r => r.r);
  return new FakeContentDb({ posts: await rows<ContentPostRow>('content_studio_posts'), schedule: await rows<ContentScheduleRow>('content_studio_schedule'), settings: await rows<ContentSettingRow>('content_studio_workflow_settings') });
}

describe('CS-074 full sorted SQL chain decimal scores', () => {
  it('upgrades populated tables and re-runs with data, preserving RLS/ACL/view/function conventions', async () => {
    const before = await query('select content_studio_cutover_snapshot() as r');
    await db.raw.exec(readFileSync(`supabase/migrations/${migration}`, 'utf8'));
    expect(await query('select content_studio_cutover_snapshot() as r')).toEqual(before);
    expect(before).toMatchObject([{ r: { posts: [expect.objectContaining({ hook_score: 7, row_version: 4, passthrough: { synthetic: 'Café\t' } })], schedule: [expect.objectContaining({ hook_score: -7, row_version: 3 })] } }]);
    expect(await query("select table_name,numeric_precision,numeric_scale from information_schema.columns where table_name in ('content_studio_posts','content_studio_schedule','content_studio_ready_queue') and column_name='hook_score' order by table_name")).toEqual(['content_studio_posts','content_studio_ready_queue','content_studio_schedule'].map(table_name => ({ table_name, numeric_precision: 6, numeric_scale: 2 })));
    for (const table of ['content_studio_posts', 'content_studio_schedule']) {
      expect((await db.raw.query('select relrowsecurity,relforcerowsecurity from pg_class where oid=$1::regclass', [table])).rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
      expect((await db.raw.query('select * from pg_policies where tablename=$1', [table])).rows).toEqual([]);
    }
    for (const role of ['anon', 'authenticated']) for (const table of ['content_studio_posts', 'content_studio_schedule', 'content_studio_ready_queue']) {
      expect((await db.raw.query<{ ok: boolean }>('select has_table_privilege($1,$2,$3) as ok', [role, table, 'SELECT'])).rows[0]!.ok).toBe(false);
    }
    for (const run of [db.asAnon, db.asOwner]) await expect(run(q => q.query('select * from content_studio_ready_queue'))).rejects.toBeDefined();
    expect((await db.raw.query<{ reloptions: string[] }>("select reloptions from pg_class where oid='content_studio_ready_queue'::regclass")).rows[0]!.reloptions).toContain('security_invoker=true');
    const functions = (await db.raw.query<{ oid: string; prosecdef: boolean; proconfig: string[] }>("select oid::text,prosecdef,proconfig from pg_proc where proname in ('content_studio_mutate','content_studio_import_run','content_studio_write_through','content_studio_shadow_import','content_studio_cutover_snapshot')")).rows;
    expect(functions.length).toBeGreaterThanOrEqual(5);
    for (const fn of functions) {
      expect(fn.prosecdef).toBe(false); expect(fn.proconfig.join()).toContain('search_path=pg_catalog, public');
      for (const role of ['anon', 'authenticated']) expect((await db.raw.query<{ ok: boolean }>('select has_function_privilege($1,$2::oid,$3) as ok', [role, fn.oid, 'EXECUTE'])).rows[0]!.ok).toBe(false);
    }
  });

  it('rolls back an out-of-range legacy integer without losing data, views or the earlier column alteration', async () => {
    const scratch = await createTestDatabase();
    try {
      for (const file of readdirSync('supabase/migrations').filter(f => /^\d+_content_.*\.sql$/.test(f) && f < migration).sort()) await scratch.raw.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'));
      await scratch.asService(q => q.query("insert into content_studio_posts(collection,library_id,hook_score) values('library','SYN-safe',7)"));
      await scratch.asService(q => q.query("insert into content_studio_schedule(content_id,hook_score) values('SYN-overflow',10000)"));
      const sql = readFileSync(`supabase/migrations/${migration}`, 'utf8');
      const end = sql.indexOf('alter table public.content_studio_schedule');
      expect(end).toBeGreaterThan(0);
      // Separate executions prove the explicit transaction, not implicit batch atomicity.
      await scratch.raw.exec(sql.slice(0, end));
      await expect(scratch.raw.exec(sql.slice(end))).rejects.toMatchObject({ code: '22003' });
      await scratch.raw.exec('rollback');
      expect((await scratch.raw.query("select data_type from information_schema.columns where table_name in ('content_studio_posts','content_studio_schedule') and column_name='hook_score' order by table_name")).rows).toEqual([{ data_type: 'integer' }, { data_type: 'integer' }]);
      expect((await scratch.asService(q => q.query('select hook_score from content_studio_schedule'))).rows).toEqual([{ hook_score: 10000 }]);
      await expect(scratch.asService(q => q.query('select * from content_studio_ready_queue'))).resolves.toBeDefined();
    } finally { await scratch.close(); }
  });

  it.each(scoreKinds.flatMap(kind => ['6.0', '6.5\u00a0', '6.5\t'].map(text => ({ kind, text }))))('$kind/$text decimals survive SQL import/measurement, reads, exact export and rollback, then drop stale text on write-through', async ({ kind, text }) => {
    await reset();
    const { repo: sheetRepo, sheet, grid, column, row } = scoreFixture(text, kind);
    // Exercise every accepted lexical form in SQL, not just the fractional one.
    const source = (await sheetRepo[scoreMethod(kind)]())[0]!, id = 'libraryId' in source.value ? source.value.libraryId : source.value.contentId;
    const e = buildTypedImport(await buildSheetMirrorSnapshot(sheetRepo, { sourceKey: 'synthetic_workbook' }), new Map(), actor);
    const original = e.rows.find(r => r.target_kind === kind && r.target_id === id)!;
    for (const [i, cell] of acceptedScores.entries()) {
      e.rows.push({ ...original, target_id: `SYN-score-${i}`, row: { ...original.row, hook_score: Number(cell.trim()), passthrough: { ...(original.row.passthrough as object), [HOOK_SCORE_RAW_KEY]: cell } } });
    }
    e.counts[kind] += acceptedScores.length;
    const operation = 'owner:synthetic_score:11111111-1111-4111-8111-111111111111', token = '22222222-2222-4222-8222-222222222222';
    e.operationId = operation;
    await query('select content_studio_shadow_claim($1,$2,$3)', [operation, e.snapshotHash, token]);
    await query('select content_studio_shadow_import($1,$2,$3,$4,$5,$6,$7,$8)', [operation, token, e.snapshotHash, actor, e.counts, e.hashes, e.exceptions, e.rows]);
    const evidence = (await query<{ result: { fullParity: { rows: number; idsEqual: boolean; unclassified: number; equal: number; fields: number }; exceptions: { class: string }[] } }>('select result from content_studio_shadow_jobs where operation_id=$1', [operation]))[0]!.result;
    expect(evidence.exceptions.filter(e => e.class.startsWith('refused_'))).toEqual([]);
    expect(evidence.fullParity).toMatchObject({ rows: e.rows.length, idsEqual: true, unclassified: 0 });
    expect(evidence.fullParity.equal).toBe(evidence.fullParity.fields);
    const dbReader = await reader(), dbRepo = new SupabaseContentRepository(dbReader);
    for (const [i, cell] of acceptedScores.entries()) {
      const stored = kind === 'schedule' ? await dbReader.getSchedule(`SYN-score-${i}`) : await dbReader.getPost(kind, `SYN-score-${i}`);
      expect(stored!.hook_score === Number(cell.trim())).toBe(true); // Postgres canonicalizes negative zero.
      expect(stored).toMatchObject({ passthrough: { [HOOK_SCORE_RAW_KEY]: cell } });
      expect((await dbRepo[scoreMethod(kind)]()).find(r => ('libraryId' in r.value ? r.value.libraryId : r.value.contentId) === `SYN-score-${i}`)!.cells.hookScore).toBe(cell);
    }
    // Remove generated probe rows from the fake export inventory only.
    const seed = { posts: (await dbReader.listPosts('library')).concat(await dbReader.listPosts('queue')).filter(r => !r.library_id.startsWith('SYN-score-')), schedule: (await dbReader.listSchedule()).filter(r => !r.content_id.startsWith('SYN-score-')), settings: await dbReader.workflowSettings() };
    const exportDb = new FakeContentDb(seed), exportRepo = new SupabaseContentRepository(exportDb);
    for (const [collection, method] of [['library','listLibrary'],['queue','listQueue'],['ready','listReadyQueue'],['schedule','listSchedule'],['queue_summary','queueSummary'],['workflow_settings','workflowSettings']] as const) expect(compareContent(collection, await sheetRepo[method](), await exportRepo[method](), 1, 0)).toMatchObject({ blocking: 0, facts: [], idsEqual: true });
    expect(Buffer.from((await contentExportRows(exportDb)).find(r => r.kind === kind && r.id === id)!.cells[LIBRARY_HEADERS.hookScore]!.value)).toEqual(Buffer.from(text));
    const exact = Buffer.from(JSON.stringify(grid)), exporter = new ContentExporter(exportDb, sheet, { checkpoints: new Map(), issues: new Map(), reports: [] });
    expect((await new ContentWriteCutover(exportRepo, exporter).rollbackToSheet(vi.fn())).parity.exact).toBe(true);
    expect(Buffer.from(JSON.stringify(grid))).toEqual(exact);
    // Re-run the migration with decimals already present, including metadata.
    const before = await query('select content_studio_cutover_snapshot() as r');
    await db.raw.exec(readFileSync(`supabase/migrations/${migration}`, 'utf8'));
    expect(await query('select content_studio_cutover_snapshot() as r')).toEqual(before);
    const stored = (await (kind === 'schedule' ? exportDb.getSchedule(id) : exportDb.getPost(kind, id)))!;
    expect((await query<{ r: { ok: boolean } }>('select content_studio_write_through($1,$2,$3,$4,$5,$6,$7) as r', ['synthetic-score-edit', mirrorHash('edit'), actor, kind, id, stored.row_version, { ...original.row, hook_score: 5.25 }]))[0]!.r.ok).toBe(true);
    const updated = await reader(), edited = (await (kind === 'schedule' ? updated.getSchedule(id) : updated.getPost(kind, id)))!;
    exportDb.externalEdit(kind, id, edited);
    expect((await exporter.run()).exact).toBe(true);
    expect(grid[row - 1]![column]!.value).toBe('5.25');
    const patch = ['synthetic-score-patch', mirrorHash('patch'), actor, kind, id, edited.row_version, { hook_score: 4.75 }];
    const callPatch = (args: unknown[]) => query<{ r: { ok: boolean; code?: string; replayed?: boolean } }>('select content_studio_apply_patch($1,$2,$3,$4,$5,$6,$7) as r', args);
    expect((await callPatch(patch))[0]!.r.ok).toBe(true);
    expect((await callPatch(patch))[0]!.r).toMatchObject({ ok: true, replayed: true });
    expect((await callPatch(['synthetic-stale-score', mirrorHash('stale'), actor, kind, id, edited.row_version, { hook_score: 3.5 }]))[0]!.r).toMatchObject({ ok: false, code: 'STALE_READ' });
    const patched = await reader();
    expect((await (kind === 'schedule' ? patched.getSchedule(id) : patched.getPost(kind, id)))!.hook_score).toBe(4.75);
  });

  it.each(scoreKinds)('%s invalid Unicode/decimal shapes remain refused with a private SQL ledger', async kind => {
    for (const text of refusedScores) {
      await reset();
      const { repo } = scoreFixture(text, kind), source = (await repo[scoreMethod(kind)]())[0]!, id = 'libraryId' in source.value ? source.value.libraryId : source.value.contentId;
      const e = buildTypedImport(await buildSheetMirrorSnapshot(repo, { sourceKey: 'synthetic_workbook' }), new Map(), actor);
      expect(e.exceptions.filter(e => e.class.startsWith('refused_'))).toEqual([{ class: 'refused_numeric', collection: kind, field: 'hook_score', hash: expect.stringMatching(/^[a-f0-9]{64}$/) }]);
      expect((await rpc(e))[0]!.r.ok).toBe(true);
      const actual = await reader();
      expect(await (kind === 'schedule' ? actual.getSchedule(id) : actual.getPost(kind, id))).toBeNull();
      const ledger = (await query<{ exceptions: unknown }>('select exceptions from content_studio_import_runs where operation_id=$1', [e.operationId]))[0]!.exceptions;
      expect(ledger).toEqual(e.exceptions);
      expect(JSON.stringify(e.exceptions.map(e => ({ ...e, hash: '' })))).not.toContain(text);
    }
  });
});
