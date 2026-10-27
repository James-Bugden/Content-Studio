import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { syntheticContentDbSeed } from '@/integrations/supabase/fake-content-db';

let pg: PGlite;
const hash = 'a'.repeat(64);
beforeAll(async () => {
  pg = await PGlite.create();
  await pg.exec('create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon, authenticated, service_role;');
  for (const file of ['20261024000100_content_authority.sql', '20261024000200_content_summary_reads.sql', '20261025000100_content_writes.sql', '20261025000400_content_markdown_export.sql', '20261027000200_post_versions_and_soft_delete.sql', '20261027000300_ai_usage.sql', '20261027000400_image_pipeline.sql', '20261027000400_image_pipeline.sql', '20261027000500_content_summary_without_copyright.sql', '20261027000500_content_summary_without_copyright.sql']) await pg.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'));
  const row = syntheticContentDbSeed().posts.find(r => r.library_id === 'SYN-L001')!;
  const columns = Object.keys(row).map(k => `"${k}"`).join(',');
  await pg.query(`insert into content_studio_posts (${columns}) select ${columns} from jsonb_populate_record(null::content_studio_posts, $1)`, [row]);
});
afterAll(async () => { await pg?.close(); });
async function write(op: string, version: number, patch: object, patchHash = hash) {
  return (await pg.query<{ result: unknown }>('select content_studio_apply_patch($1,$2,$3,$4,$5,$6,$7) result', [op, patchHash, hash, 'library', 'SYN-L001', version, patch])).rows[0]!.result;
}
it('new migration is replayable and sketches use atomic revision, operation ledger and history', async () => {
  const patch = { image_sketch: 'Title\n[A] -> [B]', has_image: 'TRUE', image_status: 'Brief Ready' };
  expect(await write('image_sql_save', 1, patch)).toMatchObject({ ok: true, revision: 2 });
  expect(await write('image_sql_save', 1, patch)).toMatchObject({ ok: true, replayed: true, revision: 2 });
  expect(await write('image_sql_save', 2, { image_sketch: 'Changed' }, 'b'.repeat(64))).toMatchObject({ ok: false, code: 'CONFLICT' });
  expect(await write('image_sql_stale', 1, { image_sketch: 'Changed' })).toMatchObject({ ok: false, code: 'STALE_READ' });
  expect((await pg.query('select image_sketch from content_studio_posts')).rows[0]).toEqual({ image_sketch: patch.image_sketch });
  expect((await pg.query('select * from content_studio_row_history')).rows).toHaveLength(1);
});
it('allows all image AI features while rejecting unknown feature names', async () => {
  for (const feature of ['image_check', 'ascii_sketch', 'image_render']) await pg.query("insert into content_studio_ai_calls(id, feature, model, input_tokens, output_tokens, cost_micros, status) values ($1,$2,'fake',1,1,1,'completed')", [crypto.randomUUID(), feature]);
  await expect(pg.query("insert into content_studio_ai_calls(id, feature, model, input_tokens, output_tokens, cost_micros, status) values ($1,'unknown','fake',1,1,1,'completed')", [crypto.randomUUID()])).rejects.toThrow(/check constraint/);
  expect((await pg.query('select feature from content_studio_ai_calls')).rows).toHaveLength(3);
});
it('copyright is retained but no longer counts as Needs Fix and private fields stay private', async () => {
  const row = syntheticContentDbSeed().posts.find(r => r.collection === 'queue')!;
  row.copyright_qa = 'REWORK'; row.duplicate_qa = 'PASS'; row.review_status = 'Pending';
  const keys = Object.keys(row).map(k => `"${k}"`).join(',');
  await pg.query(`insert into content_studio_posts (${keys}) select ${keys} from jsonb_populate_record(null::content_studio_posts, $1)`, [row]);
  expect((await pg.query<{ counts: { 'Needs Fix': number } }>('select counts from content_studio_queue_summary')).rows[0]!.counts['Needs Fix']).toBe(0);
  for (const role of ['anon', 'authenticated']) await expect(pg.transaction(async tx => {
    await tx.exec(`set local role ${role}`); await tx.exec('select image_sketch from content_studio_posts');
  })).rejects.toThrow(/permission denied/);
});
