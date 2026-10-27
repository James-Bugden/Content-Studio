import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { syntheticContentDbSeed } from '@/integrations/supabase/fake-content-db';

let pg: PGlite;
const hash = 'a'.repeat(64);
beforeAll(async () => {
  pg = await PGlite.create();
  await pg.exec('create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon, authenticated, service_role;');
  for (const file of ['20261024000100_content_authority.sql', '20261024000200_content_summary_reads.sql', '20261025000100_content_writes.sql', '20261025000400_content_markdown_export.sql', '20261027000200_post_versions_and_soft_delete.sql']) {
    await pg.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'));
  }
  const row = syntheticContentDbSeed().posts.find(r => r.library_id === 'SYN-L001')!;
  const columns = Object.keys(row).map(k => `"${k}"`).join(',');
  await pg.query(`insert into content_studio_posts (${columns}) select ${columns} from jsonb_populate_record(null::content_studio_posts, $1)`, [row]);
});
afterAll(async () => { await pg?.close(); });
async function write(op: string, version: number, data: object, patchHash = hash) {
  return (await pg.query<{ result: { ok: boolean; code: string | null; revision: number; replayed?: boolean } }>('select content_studio_apply_patch($1,$2,$3,$4,$5,$6,$7) result', [op, patchHash, hash, 'library', 'SYN-L001', version, data])).rows[0]!.result;
}

it('real SQL saves versions, audits once, replays, refuses changed operations, hides and restores tombstones with CAS', async () => {
  const versions = [{ platform: 'X', english: 'Synthetic text', sourceHash: 'a'.repeat(16) }];
  const first = await write('synthetic_sql_versions', 1, { draft_content: 'Synthetic text', platform_versions: versions });
  expect(first).toMatchObject({ ok: true, revision: 2 });
  expect(await write('synthetic_sql_versions', 1, { draft_content: 'Synthetic text', platform_versions: versions })).toMatchObject({ ...first, replayed: true });
  expect(await write('synthetic_sql_versions', 2, { draft_content: 'Changed' }, 'b'.repeat(64))).toMatchObject({ ok: false, code: 'CONFLICT' });
  expect(await write('synthetic_sql_stale_delete', 1, { deleted_at: new Date().toISOString() })).toMatchObject({ ok: false, code: 'STALE_READ' });
  const data = { deleted_at: new Date().toISOString() };
  expect(await write('synthetic_sql_delete', 2, data)).toMatchObject({ ok: true, revision: 3 });
  expect(await write('synthetic_sql_delete', 2, data)).toMatchObject({ ok: true, revision: 3, replayed: true });
  expect((await pg.query('select * from content_studio_ready_queue where library_id=$1', ['SYN-L001'])).rows).toHaveLength(0);
  expect(await write('synthetic_sql_dead_edit', 3, { draft_content: 'Should never write' })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  expect(await write('synthetic_sql_stale_restore', 2, { deleted_at: null })).toMatchObject({ ok: false, code: 'STALE_READ' });
  expect(await write('synthetic_sql_restore', 3, { deleted_at: null })).toMatchObject({ ok: true, revision: 4 });
  expect((await pg.query<{ platform_versions: unknown }>('select platform_versions from content_studio_posts')).rows[0]!.platform_versions).toEqual(versions);
  expect((await pg.query('select * from content_studio_row_history')).rows).toHaveLength(3);
});

it('does not grant anonymous or authenticated access to the mutation or tombstone data', async () => {
  for (const role of ['anon', 'authenticated']) {
    await expect(pg.transaction(async tx => { await tx.exec(`set local role ${role}`); await tx.query('select * from content_studio_posts'); })).rejects.toThrow(/permission denied/);
    await expect(pg.transaction(async tx => { await tx.exec(`set local role ${role}`); await tx.query('select content_studio_apply_patch($1,$2,$3,$4,$5,$6,$7)', ['synthetic_denied', hash, hash, 'library', 'SYN-L001', 4, { deleted_at: null }]); })).rejects.toThrow(/permission denied/);
  }
});

it('real SQL expires restore and uses the database clock for deletion', async () => {
  expect(await write('synthetic_sql_server_clock', 4, { deleted_at: '2099-01-01T00:00:00Z' })).toMatchObject({ ok: true, revision: 5 });
  const row = (await pg.query<{ deleted_at: Date }>('select deleted_at from content_studio_posts')).rows[0]!;
  expect(Math.abs(Date.now() - new Date(row.deleted_at).getTime())).toBeLessThan(5_000);
  await pg.exec("update content_studio_posts set deleted_at=now()-interval '31 seconds'");
  expect(await write('synthetic_sql_expired_restore', 5, { deleted_at: null })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  expect((await pg.query("select * from content_studio_audit_events where operation_id='synthetic_sql_expired_restore' and outcome='not_found'")).rows).toHaveLength(1);
});
