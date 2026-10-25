import { readFileSync, readdirSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../replies/support/db';

let db: TestDatabase;
const build = 'a'.repeat(40), importId = 'synthetic-import';
const query = (sql: string, args: unknown[] = []) => db.asService(q => q.query(sql, args));
beforeAll(async () => {
  db = await createTestDatabase();
  for (const file of readdirSync('supabase/migrations').filter(f => /^\d+_content_.*\.sql$/.test(f)).sort()) {
    if (file.includes('cutover_live')) await db.raw.exec('alter default privileges in schema public grant all on tables to anon,authenticated');
    if (file.includes('backup_gate_waiver')) await db.raw.exec('alter default privileges in schema public grant all on tables to service_role');
    await db.raw.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'));
  }
  await query('insert into content_studio_import_runs(operation_id,snapshot_hash,counts,hashes,exceptions) values($1,$2,$3,$4,$5)', [importId, 'b'.repeat(64), { library: 0, queue: 0, schedule: 0, workflow_settings: 0 }, { library: 'b'.repeat(64), queue: 'b'.repeat(64), schedule: 'b'.repeat(64), workflow_settings: 'b'.repeat(64) }, []]);
}, 120_000);
afterAll(async () => { await db?.close(); });
async function parity(samples: unknown) {
  await query('select content_studio_cutover_record($1,$2,$3,$4)', ['parity', build, importId, { coverage: 'all-rows', samples }]);
}
const samples = () => Object.fromEntries(['library','queue','ready','schedule','queue_summary','workflow_settings'].map(k => [k, { idsEqual: true, fields: 1000, equal: 1000, blocking: 0, lagMs: 100 }]));
describe('DB-10 actual SQL measured gates / security / consistent snapshots', () => {
  it('forces zero-policy RLS and denies browser roles on every new table and RPC, despite hostile default grants', async () => {
    for (const table of ['content_studio_backup_waivers', 'content_studio_cutover_state', 'content_studio_cutover_evidence', 'content_studio_cutover_jobs', 'content_studio_cutover_authority']) {
      expect((await db.raw.query('select relrowsecurity,relforcerowsecurity from pg_class where oid=$1::regclass', [table])).rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
      expect((await db.raw.query('select * from pg_policies where tablename=$1', [table])).rows).toHaveLength(0);
      for (const role of ['anon', 'authenticated']) for (const verb of ['SELECT','INSERT','UPDATE','DELETE']) {
        expect((await db.raw.query<{ok: boolean}>('select has_table_privilege($1,$2,$3) as ok', [role, table, verb])).rows[0]!.ok).toBe(false);
      }
      for (const run of [db.asAnon, db.asOwner]) await expect(run(q => q.query(`select * from ${table}`))).rejects.toBeDefined();
    }
    const functions = (await db.raw.query<{ oid: string; prosecdef: boolean; proconfig: string[] }>("select oid::text,prosecdef,proconfig from pg_proc where proname like 'content_studio_cutover_%' or proname='content_studio_restore_markdown_link'")).rows;
    expect(functions).toHaveLength(20);
    for (const fn of functions) {
      expect(fn.prosecdef).toBe(false); expect(fn.proconfig.join()).toContain('search_path=pg_catalog, public');
      for (const role of ['anon', 'authenticated']) expect((await db.raw.query<{ok: boolean}>('select has_function_privilege($1,$2::oid,$3) as ok', [role, fn.oid, 'EXECUTE'])).rows[0]!.ok).toBe(false);
    }
    for (const run of [db.asAnon, db.asOwner]) await expect(run(q => q.query('select content_studio_cutover_snapshot()'))).rejects.toBeDefined();
    for (const verb of ['UPDATE', 'DELETE']) expect((await db.raw.query<{ok: boolean}>('select has_table_privilege($1,$2,$3) as ok', ['service_role', 'content_studio_backup_waivers', verb])).rows[0]!.ok).toBe(false);
  });
  it('requires all six full observations, real thresholds and matching import/build; malformed, missing, unknown and red are refusals', async () => {
    const gate = () => query('select content_studio_cutover_gate($1,$2)', ['db-read', build]);
    await expect(gate()).rejects.toBeDefined();
    await parity(samples()); await expect(gate()).resolves.toBeDefined();
    for (const patch of [{ idsEqual: false }, { equal: 998 }, { blocking: 1 }, { lagMs: null }, { lagMs: 900001 }, { fields: null }, { equal: 1001 }]) {
      await parity({ ...samples(), library: { ...samples().library, ...patch } });
      await expect(gate()).rejects.toBeDefined();
    }
    const missing = samples(); delete missing.queue; await parity(missing); await expect(gate()).rejects.toBeDefined();
    await parity(samples());
    await expect(query('select content_studio_cutover_gate($1,$2)', ['db-read', 'c'.repeat(40)])).rejects.toBeDefined();
    await expect(query('select content_studio_cutover_gate($1,$2)', ['db', build])).rejects.toBeDefined();
    await expect(query('select content_studio_cutover_record($1,$2,$3,$4)', ['parity', build, 'synthetic-obsolete', {}])).rejects.toBeDefined();
  });
  it('reads six authoritative tables in one SQL snapshot even with a pending Markdown export', async () => {
    const snapshot = (await query('select content_studio_cutover_snapshot() as s')).rows[0]!.s;
    expect(Object.keys(snapshot as object).sort()).toEqual(['posts','schedule','workflow_settings','row_history','operations','audit_events'].sort());
    await query("insert into content_studio_markdown_export(library_id,row_version,expected_body,body) values('SYN-missing',1,'','Synthetic')");
    expect((await query('select content_studio_cutover_snapshot() as s')).rows[0]!.s).toEqual(snapshot);
  });
});
