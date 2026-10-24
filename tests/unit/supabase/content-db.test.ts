import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SupabaseContentDb } from '@/integrations/supabase/content-db';
import { SupabaseContentRepository } from '@/integrations/supabase/content-repository';
import { FakeContentDb, syntheticContentDbSeed } from '@/integrations/supabase/fake-content-db';

const url = 'https://synthetic-db.supabase.co';
const serviceKey = 'SYNTHETIC_SERVICE_KEY_ONLY';
const options = { url, serviceKey };

describe('read-only PostgREST transport', () => {
  it('continues through a hosted row cap, requests stable order, credentials and timeout', async () => {
    const seed = syntheticContentDbSeed();
    const source = await new FakeContentDb(seed).listPosts('library');
    const request = vi.fn<typeof fetch>(async (input, init) => {
      const target = new URL(String(input));
      expect(target.pathname).toBe('/rest/v1/content_studio_posts');
      expect(target.searchParams.get('collection')).toBe('eq.library');
      expect(target.searchParams.get('order')).toBe('source_sheet_row.asc.nullslast,library_id.asc');
      expect(init).toMatchObject({ method: 'GET', cache: 'no-store', headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
      expect(init!.signal).toBeInstanceOf(AbortSignal);
      const offset = Number(target.searchParams.get('offset'));
      return Response.json(source.slice(offset, offset + 2), { headers: { 'content-range': `${offset}-${Math.min(offset + 1, source.length - 1)}/${source.length}` } });
    });
    expect(await new SupabaseContentDb({ ...options, fetch: request }).listPosts('library')).toEqual(source);
    expect(request.mock.calls.length).toBe(Math.ceil(source.length / 2));
  });
  it('encodes stable IDs as a query value, never a query fragment', async () => {
    const request = vi.fn<typeof fetch>(async input => { const q = new URL(String(input)).searchParams; expect(q.get('library_id')).toBe('eq.SYNTH&collection=eq.queue'); expect(q.get('collection')).toBe('eq.library'); return Response.json([]); });
    expect(await new SupabaseContentDb({ ...options, fetch: request }).getPost('library', 'SYNTH&collection=eq.queue')).toBeNull();
  });
  it.each([429, 401, 503])('redacts provider response bodies at HTTP %s', async status => {
    const db = new SupabaseContentDb({ ...options, fetch: vi.fn(async () => new Response(`${url} private synthetic body ${serviceKey}`, { status })) });
    try { await db.listSchedule(); expect.fail('must fail'); } catch (error) {
      expect(error).toMatchObject({ code: status === 429 ? 'RATE_LIMITED' : 'PROVIDER_UNAVAILABLE' });
      expect(JSON.stringify(error)).not.toContain(url); expect(JSON.stringify(error)).not.toContain(serviceKey); expect(JSON.stringify(error)).not.toContain('private');
    }
  });
  it('redacts thrown network errors and rejects malformed response envelopes', async () => {
    const request = vi.fn<typeof fetch>(async () => { throw new Error(`${url} ${serviceKey}`); });
    await expect(new SupabaseContentDb({ ...options, fetch: request }).schemaVersion()).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE', details: { provider: 'db', reason: 'network' } });
    await expect(new SupabaseContentDb({ ...options, fetch: vi.fn(async () => Response.json({ secret: serviceKey })) }).listSchedule()).rejects.toMatchObject({ code: 'SCHEMA_DRIFT' });
  });
  it('refuses untrusted URL targets and short keys', () => {
    for (const url of ['https://example.com', 'https://synthetic-db.supabase.co/path', 'https://synthetic-db.supabase.co@evil.test']) expect(() => new SupabaseContentDb({ url, serviceKey })).toThrow();
    expect(() => new SupabaseContentDb({ url, serviceKey: 'short' })).toThrow();
  });
  it('rehydrates typed UTC timestamps and hash stamps without losing zero/null metrics', async () => {
    const seed = syntheticContentDbSeed(); const row = seed.schedule.find(r => r.typefully_status === 'Published')!;
    row.final_synced_at = '2026-10-01T01:00:00+00:00'; row.final_synced_hash = 'abcdef12'; row.published_at = '2026-10-01T00:00:04+00:00'; row.analytics_synced_at = '2026-10-02T01:00:00+00:00';
    const request = vi.fn<typeof fetch>(async input => String(input).includes('schema_version') ? Response.json([{ version: 1 }], { headers: { 'content-range': '0-0/1' } }) : Response.json([row], { headers: { 'content-range': '0-0/1' } }));
    const record = await new SupabaseContentRepository(new SupabaseContentDb({ ...options, fetch: request })).getSchedule(String(row.content_id));
    expect(record.cells.finalSyncedAt).toBe('2026-10-01T09:00:00+08:00 #abcdef12');
    expect(record.cells.publishedAt).toBe('2026-10-01T08:00:04+08:00');
    expect(record.value.metrics.replies).toBe(0); expect(record.value.metrics.newFollowers).toBeNull();
  });
});

describe('QueueSummaryRow SQL parity (DB-1 review item 8)', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await PGlite.create();
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to service_role;');
    for (const migration of ['20261024000100_content_authority.sql', '20261024000200_content_summary_reads.sql']) await db.exec(readFileSync(`supabase/migrations/${migration}`, 'utf8'));
  });
  afterAll(async () => { await db?.close(); });
  it('groups one source across multiple masters, exposes all named counts and matches fake', async () => {
    const seed = syntheticContentDbSeed(); seed.posts = seed.posts.filter(r => r.collection === 'queue').slice(0, 3);
    seed.posts[0]!.source_master_file_url = 'https://example.com/z';
    seed.posts[1]!.source_master_file_url = 'https://example.com/a'; seed.posts[1]!.review_status = 'Approved'; seed.posts[1]!.queue_for_schedule = true;
    seed.posts[2]!.copyright_qa = 'REWORK';
    for (const row of seed.posts) {
      const keys = Object.keys(row);
      await db.query(`insert into content_studio_posts (${keys.join(',')}) select ${keys.join(',')} from jsonb_populate_record(null::content_studio_posts, $1::jsonb)`, [JSON.stringify(row)]);
    }
    const result = await db.query('select content_source, master_link, count::integer, counts from content_studio_queue_summary order by content_source');
    expect(result.rows).toEqual(await new FakeContentDb(seed).queueSummary());
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ master_link: 'https://example.com/a', count: 3, counts: { Total: 3, 'Not Reviewed': 2, Approved: 1, Queued: 1, 'Needs Fix': 1 } });
  });
  it('retains security_invoker and server-only view grants', async () => {
    const { rows } = await db.query<{ reloptions: string[] }>("select reloptions from pg_class where relname='content_studio_queue_summary'");
    expect(rows[0]!.reloptions).toContain('security_invoker=true');
    for (const role of ['anon', 'authenticated']) {
      await expect(db.transaction(async tx => { await tx.exec(`set local role ${role}`); await tx.query('select * from content_studio_queue_summary'); })).rejects.toThrow(/permission denied/);
    }
    await db.transaction(async tx => { await tx.exec('set local role service_role'); expect((await tx.query('select * from content_studio_queue_summary')).rows).toHaveLength(1); });
  });
});
