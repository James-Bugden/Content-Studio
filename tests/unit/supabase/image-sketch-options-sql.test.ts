import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { syntheticContentDbSeed } from '@/integrations/supabase/fake-content-db';

/** #248 migration: the image_sketch_options column and its guarded write path. */
let pg: PGlite;
const hash = 'a'.repeat(64);
const FILES = ['20261024000100_content_authority.sql', '20261024000200_content_summary_reads.sql', '20261025000100_content_writes.sql', '20261025000400_content_markdown_export.sql',
  '20261027000200_post_versions_and_soft_delete.sql', '20261027000300_ai_usage.sql', '20261027000400_image_pipeline.sql', '20261027000500_content_summary_without_copyright.sql',
  '20261028000200_image_sketch_options.sql', '20261028000200_image_sketch_options.sql'];
const option = (n: number) => ({ id: `abcdef0${n}`, title: `Option ${n}`, reason: 'It fits.', layout: 'steps', sketch: 'A\n+---+\n| B |\n+---+' });
beforeAll(async () => {
  pg = await PGlite.create();
  await pg.exec('create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon, authenticated, service_role;');
  // The last file is applied twice on purpose: the migration must be replayable.
  for (const file of FILES) await pg.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'));
  const row = syntheticContentDbSeed().posts.find(r => r.library_id === 'SYN-L001')!;
  const columns = Object.keys(row).map(k => `"${k}"`).join(',');
  await pg.query(`insert into content_studio_posts (${columns}) select ${columns} from jsonb_populate_record(null::content_studio_posts, $1)`, [row]);
}, 120_000);
afterAll(async () => { await pg?.close(); });
async function write(op: string, version: number, patch: object, patchHash = hash) {
  return (await pg.query<{ result: unknown }>('select content_studio_apply_patch($1,$2,$3,$4,$5,$6,$7) result', [op, patchHash, hash, 'library', 'SYN-L001', version, patch])).rows[0]!.result;
}

it('adds a nullable jsonb column once and lists it in the mutate allow-list exactly once', async () => {
  expect((await pg.query<{ data_type: string; is_nullable: string }>("select data_type, is_nullable from information_schema.columns where table_name = 'content_studio_posts' and column_name = 'image_sketch_options'")).rows)
    .toEqual([{ data_type: 'jsonb', is_nullable: 'YES' }]);
  const def = (await pg.query<{ def: string }>("select pg_get_functiondef('content_studio_private.content_studio_mutate(text,text,text,text,text,text,bigint,jsonb)'::regprocedure) def")).rows[0]!.def;
  expect(def.match(/'image_sketch_options'/g)).toHaveLength(1);
  expect(def).toContain("'image_sketch'");
});
it('saves options through the guarded path with revision, idempotency and history', async () => {
  const patch = { image_sketch_options: [option(1), option(2)], image_sketch: 'A' };
  expect(await write('opts_save', 1, patch)).toMatchObject({ ok: true, revision: 2 });
  expect(await write('opts_save', 1, patch)).toMatchObject({ ok: true, replayed: true, revision: 2 });
  expect(await write('opts_stale', 1, { image_sketch_options: [option(3)] })).toMatchObject({ ok: false, code: 'STALE_READ' });
  expect(await write('opts_save', 2, { image_sketch_options: [option(3)] }, 'b'.repeat(64))).toMatchObject({ ok: false, code: 'CONFLICT' });
  const saved = (await pg.query<{ image_sketch_options: { id: string }[] }>('select image_sketch_options from content_studio_posts')).rows[0]!;
  expect(saved.image_sketch_options.map(o => o.id)).toEqual(['abcdef01', 'abcdef02']);
  expect((await pg.query('select * from content_studio_row_history')).rows).toHaveLength(1);
});
it('rejects a non-array, an empty array and more than nine options; null clears', async () => {
  for (const [i, bad] of ([{ a: 1 }, [], Array.from({ length: 10 }, (_, n) => option(n))] as unknown[]).entries()) {
    await expect(write(`opts_bad_${i}`, 2, { image_sketch_options: bad })).rejects.toThrow(/check constraint|content_studio_image_sketch_options_shape/);
  }
  expect(await write('opts_clear', 2, { image_sketch_options: null })).toMatchObject({ ok: true, revision: 3 });
  expect((await pg.query('select image_sketch_options from content_studio_posts')).rows[0]).toEqual({ image_sketch_options: null });
});
it('keeps the private columns private and the ready queue view readable by the service role', async () => {
  for (const role of ['anon', 'authenticated']) await expect(pg.transaction(async tx => {
    await tx.exec(`set local role ${role}`); await tx.exec('select image_sketch_options from content_studio_posts');
  })).rejects.toThrow(/permission denied/);
  await pg.transaction(async tx => { await tx.exec('set local role service_role'); await tx.exec('select image_sketch_options from content_studio_ready_queue'); });
});
