import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, expect, it } from 'vitest';

/** #249 migration: the backup run history table. Applied twice on purpose (replayable). */
let pg: PGlite;
const FILE = 'supabase/migrations/20261029000100_weekly_backup_runs.sql';
beforeAll(async () => {
  pg = await PGlite.create();
  await pg.exec('create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon, authenticated, service_role;');
  await pg.exec(readFileSync(FILE, 'utf8'));
  await pg.exec(readFileSync(FILE, 'utf8'));
}, 120_000);
afterAll(async () => { await pg?.close(); });

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

it('creates the table once with RLS on and no policies', async () => {
  const t = (await pg.query<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class where relname = 'content_studio_backup_runs'")).rows;
  expect(t).toEqual([{ relrowsecurity: true }]);
  expect((await pg.query("select 1 from pg_policies where tablename = 'content_studio_backup_runs'")).rows).toHaveLength(0);
  expect((await pg.query("select 1 from pg_indexes where tablename = 'content_studio_backup_runs' and indexname = 'content_studio_backup_runs_started'")).rows).toHaveLength(1);
});
it('is service-role only', async () => {
  const privileges = async (role: string) => (await pg.query<{ p: string }>(
    "select privilege_type p from information_schema.role_table_grants where table_name = 'content_studio_backup_runs' and grantee = $1 order by 1", [role])).rows.map(r => r.p);
  expect(await privileges('service_role')).toEqual(['INSERT', 'SELECT', 'UPDATE']);
  expect(await privileges('anon')).toEqual([]);
  expect(await privileges('authenticated')).toEqual([]);
  expect(await privileges('PUBLIC')).toEqual([]);
});
it('accepts a running row, then a finished success, and enforces the shape', async () => {
  await pg.query("insert into content_studio_backup_runs (id, trigger_kind) values ($1, 'cron')", [id(1)]);
  await pg.query("update content_studio_backup_runs set status = 'success', finished_at = now(), file_name = 'content-studio-backup-2026-11-02-0300.json.gz', size_bytes = 10, row_counts = '{\"posts\":2}' where id = $1", [id(1)]);
  await expect(pg.query("insert into content_studio_backup_runs (id, trigger_kind, status) values ($1, 'manual', 'success')", [id(2)])).rejects.toThrow(); // finished without a time
  await expect(pg.query("insert into content_studio_backup_runs (id, trigger_kind) values ($1, 'webhook')", [id(3)])).rejects.toThrow();
  await expect(pg.query("insert into content_studio_backup_runs (id, trigger_kind, file_name) values ($1, 'cron', '../etc/passwd')", [id(4)])).rejects.toThrow();
  await expect(pg.query("insert into content_studio_backup_runs (id, trigger_kind, error_message) values ($1, 'cron', $2)", [id(5), 'x'.repeat(301)])).rejects.toThrow();
});
it('ignores a duplicate id so a replayed run cannot create a second row', async () => {
  const result = await pg.query("insert into content_studio_backup_runs (id, trigger_kind) values ($1, 'cron') on conflict do nothing returning id", [id(1)]);
  expect(result.rows).toHaveLength(0);
});
