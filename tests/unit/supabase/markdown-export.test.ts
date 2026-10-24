import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { syntheticContentDbSeed } from '@/integrations/supabase/fake-content-db';
import { SupabaseContentDb } from '@/integrations/supabase/content-db';

let pg: PGlite;
beforeAll(async () => {
  pg = await PGlite.create();
  await pg.exec('create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon, authenticated, service_role;');
  for (const name of readdirSync('supabase/migrations').filter(name => /^\d+_content_.*\.sql$/.test(name)).sort()) await pg.exec(readFileSync(`supabase/migrations/${name}`, 'utf8'));
});
afterAll(async () => { await pg?.close(); });
beforeEach(async () => {
  await pg.exec('truncate content_studio_posts,content_studio_schedule,content_studio_operations,content_studio_row_history,content_studio_audit_events,content_studio_markdown_export restart identity cascade');
  const row = syntheticContentDbSeed().posts.find(row => row.library_id === 'SYN-L008')!;
  await pg.query('insert into content_studio_posts select * from jsonb_populate_record(null::content_studio_posts,$1)', [{ ...row, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), review_status: 'Approved' }]);
});
async function patch(body: string, version = 1, operation = 'synthetic_sql_patch') {
  return pg.transaction(async tx => {
    await tx.exec('set local role service_role');
    return (await tx.query<{ result: { ok: boolean; replayed?: boolean } }>('select content_studio_apply_patch($1,$2,$3,\'library\',\'SYN-L008\',$4,$5) result', [operation, body === 'First' ? 'a'.repeat(64) : 'b'.repeat(64), 'c'.repeat(64), version, { draft_content: body }])).rows[0]!.result;
  });
}
it('one apply_patch atomically enqueues, resets approval, coalesces and replays without another job', async () => {
  expect((await patch('First')).ok).toBe(true);
  expect((await pg.query<{ review_status: string }>('select review_status from content_studio_posts')).rows[0]?.review_status).toBe('Not Reviewed');
  const first = (await pg.query<{ expected_body: string; body: string; row_version: number; library_id: string; queued_at: string }>('select * from content_studio_markdown_export')).rows[0]!;
  expect(first).toMatchObject({ body: 'First', row_version: 2 });
  expect(await patch('First')).toMatchObject({ ok: true, replayed: true });
  expect((await patch('Second', 2, 'synthetic_second_sql_patch')).ok).toBe(true);
  expect((await pg.query('select * from content_studio_markdown_export')).rows).toEqual([{ ...first, body: 'Second', row_version: 3 }]);
  await pg.query('select content_studio_complete_markdown_export($1,$2,$3,$4)', ['SYN-L008', 2, first.expected_body, 'First']);
  expect((await pg.query('select * from content_studio_markdown_export')).rows[0]).toMatchObject({ body: 'Second', expected_body: 'First' });
  await pg.query('select content_studio_complete_markdown_export($1,$2,$3,$4)', ['SYN-L008', 3, 'First', 'Second']);
  expect((await pg.query('select * from content_studio_markdown_export')).rows).toEqual([]);
});
it('a forced outbox failure rolls back body, approval, history, audit and idempotency ledger', async () => {
  await pg.exec("alter table content_studio_markdown_export add constraint synthetic_fail check (body <> 'First')");
  try {
    await expect(patch('First')).rejects.toThrow();
    expect((await pg.query('select row_version,review_status from content_studio_posts')).rows[0]).toEqual({ row_version: 1, review_status: 'Approved' });
    for (const table of ['row_history', 'audit_events', 'operations', 'markdown_export']) expect((await pg.query(`select * from content_studio_${table}`)).rows).toEqual([]);
  } finally { await pg.exec('alter table content_studio_markdown_export drop constraint synthetic_fail'); }
});
it('forces RLS without policies and denies all table/function access to browser roles', async () => {
  expect((await pg.query("select relrowsecurity,relforcerowsecurity from pg_class where relname='content_studio_markdown_export'")).rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  expect((await pg.query("select * from pg_policies where tablename='content_studio_markdown_export'")).rows).toEqual([]);
  for (const role of ['anon', 'authenticated']) for (const statement of [
    'select * from content_studio_markdown_export',
    "select content_studio_complete_markdown_export('SYN-L008',1,'','')",
    "select content_studio_apply_patch('synthetic_denied','" + 'a'.repeat(64) + "','" + 'b'.repeat(64) + "','library','SYN-L008',1,'{}')",
  ]) await expect(pg.transaction(async tx => { await tx.exec(`set local role ${role}`); await tx.exec(statement); })).rejects.toThrow(/permission denied/);
});
it('executes production PostgREST queue and completion arguments against the SQL catalog', async () => {
  await patch('First');
  const client = new SupabaseContentDb({ url: 'http://127.0.0.1:54321', serviceKey: 'synthetic-service-key-not-a-real-key',
    fetch: async (url, init) => {
      const path = new URL(String(url));
      if (init?.method === 'GET') {
        expect(path.pathname).toBe('/rest/v1/content_studio_markdown_export');
        expect(path.searchParams.get('order')).toBe('library_id.asc');
        const result = await pg.query('select * from content_studio_markdown_export order by library_id');
        return Response.json(result.rows, { headers: { 'content-range': `0-${result.rows.length - 1}/${result.rows.length}` } });
      }
      expect(path.pathname).toBe('/rest/v1/rpc/content_studio_complete_markdown_export');
      const input = JSON.parse(String(init?.body));
      const names = (await pg.query<{ proargnames: string[] }>("select proargnames from pg_proc where proname='content_studio_complete_markdown_export'")).rows[0]!.proargnames;
      expect(Object.keys(input).sort()).toEqual([...names].sort());
      const result = await pg.transaction(async tx => {
        await tx.exec('set local role service_role');
        return tx.query<{ result: unknown }>('select content_studio_complete_markdown_export($1,$2,$3,$4) result', names.map(name => input[name]));
      });
      return Response.json(result.rows[0]!.result);
    } });
  const jobs = await client.pendingMarkdownExports();
  expect(jobs).toHaveLength(1);
  expect(jobs[0]).toMatchObject({ libraryId: 'SYN-L008', version: '2', body: 'First' });
  expect(Number.isFinite(jobs[0]!.since)).toBe(true);
  await client.completeMarkdownExport(jobs[0]!);
  expect(await client.pendingMarkdownExports()).toEqual([]);
});
