import { describe, expect, it, vi } from 'vitest';
import { PostgrestBackupRowSource, keysetFilter } from '@/integrations/supabase/backup-row-source';
import { SupabaseBackupRunStore } from '@/integrations/supabase/backup-run-store';

const URL_ = 'https://synthproject.supabase.co';
const KEY = 'synthetic-service-key-0123456789';

describe('keyset filter', () => {
  it('single key', () => {
    expect(keysetFilter(['history_id'], true, { history_id: 12 })).toBe('(history_id.lt."12")');
    expect(keysetFilter(['id'], false, { id: 'abc' })).toBe('(id.gt."abc")');
  });
  it('composite key nests equality on the leading columns', () => {
    expect(keysetFilter(['collection', 'library_id'], false, { collection: 'library', library_id: 'SYN-L02' }))
      .toBe('(collection.gt."library",and(collection.eq."library",library_id.gt."SYN-L02"))');
  });
  it('quotes values so commas, parens and quotes cannot alter the filter', () => {
    expect(keysetFilter(['id'], false, { id: 'a",b)or(x.eq.1' })).toBe('(id.gt."a\\",b)or(x.eq.1")');
  });
});

function source(handler: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => { calls.push({ url, init }); return handler(url, init); });
  return { src: new PostgrestBackupRowSource({ url: URL_, serviceKey: KEY, fetch: fetchImpl as unknown as typeof fetch }), calls };
}

describe('PostgREST row source', () => {
  it('pages with order, limit and the keyset filter, using the service key', async () => {
    const { src, calls } = source(() => Response.json([{ id: 'b' }]));
    const rows = await src.page({ table: 'content_studio_posts', order: ['collection', 'library_id'], desc: false, after: { collection: 'a', library_id: 'z' }, limit: 500 });
    expect(rows).toEqual([{ id: 'b' }]);
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe('/rest/v1/content_studio_posts');
    expect(url.searchParams.get('order')).toBe('collection.asc,library_id.asc');
    expect(url.searchParams.get('limit')).toBe('500');
    expect(url.searchParams.get('or')).toBe('(collection.gt."a",and(collection.eq."a",library_id.gt."z"))');
    expect(url.searchParams.get('offset')).toBeNull();
    expect((calls[0]!.init.headers as Record<string, string>).apikey).toBe(KEY);
  });
  it('caps the page at 1000 rows and sorts descending for the newest-first slices', async () => {
    const { src, calls } = source(() => Response.json([]));
    await src.page({ table: 'content_studio_row_history', order: ['history_id'], desc: true, after: null, limit: 99999 });
    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get('limit')).toBe('1000');
    expect(url.searchParams.get('order')).toBe('history_id.desc');
    expect(url.searchParams.has('or')).toBe(false);
  });
  it('refuses odd table, column or select names', async () => {
    const { src, calls } = source(() => Response.json([]));
    await expect(src.page({ table: 'x?select=*&', order: ['id'], desc: false, after: null, limit: 1 })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(src.page({ table: 'posts', order: ['id;drop'], desc: false, after: null, limit: 1 })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(src.page({ table: 'posts', order: ['id'], select: 'id,(a)', desc: false, after: null, limit: 1 })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(calls).toHaveLength(0);
  });
  it('maps a missing table to NOT_FOUND and other errors to a typed provider error without the body', async () => {
    expect((await source(() => new Response('{}', { status: 404 })).src.page({ table: 'gone', order: ['id'], desc: false, after: null, limit: 1 }).catch(e => e)).code).toBe('NOT_FOUND');
    expect((await source(() => Response.json({ code: 'PGRST205', message: 'secret detail' }, { status: 400 })).src.page({ table: 'gone', order: ['id'], desc: false, after: null, limit: 1 }).catch(e => e)).code).toBe('NOT_FOUND');
    const err = await source(() => Response.json({ message: 'secret detail' }, { status: 500 })).src.page({ table: 'p', order: ['id'], desc: false, after: null, limit: 1 }).catch(e => e);
    expect(err.code).toBe('PROVIDER_UNAVAILABLE');
    expect(JSON.stringify(err.details)).not.toContain('secret');
  });
  it('rejects a non-Supabase URL and a short key', () => {
    expect(() => new PostgrestBackupRowSource({ url: 'https://evil.example', serviceKey: KEY })).toThrow();
    expect(() => new PostgrestBackupRowSource({ url: URL_, serviceKey: 'short' })).toThrow();
  });
  it('counts from content-range', async () => {
    const { src } = source(() => new Response('[]', { headers: { 'content-range': '0-0/1234' } }));
    expect(await src.count('content_studio_row_history')).toBe(1234);
  });
});

describe('Supabase run store', () => {
  const row = (over: object = {}) => ({ id: 'r1', trigger_kind: 'cron', status: 'success', started_at: '2026-11-01T19:00:00Z', finished_at: '2026-11-01T19:01:00Z', file_name: 'f.json.gz', size_bytes: '123', row_counts: { posts: 2 }, error_message: null, ...over });
  function store(handler: (url: string, init: RequestInit) => Response) {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => { calls.push({ url, init }); return handler(url, init); });
    return { s: new SupabaseBackupRunStore({ url: URL_, serviceKey: KEY, fetch: fetchImpl as unknown as typeof fetch, now: () => Date.parse('2026-11-01T19:05:00Z') }), calls };
  }
  it('replays an existing id without inserting', async () => {
    const { s, calls } = store(() => Response.json([row()]));
    expect(await s.begin({ id: 'r1', trigger: 'manual', startedAt: 'x', buildCommit: null })).toMatchObject({ kind: 'replay', run: { id: 'r1', sizeBytes: 123 } });
    expect(calls.every(c => c.init.method === 'GET')).toBe(true);
  });
  it('reports busy when a recent run is still running, and starts otherwise', async () => {
    let step = 0;
    const busy = store(() => (step++ === 0 ? Response.json([]) : Response.json([row({ status: 'running', finished_at: null })])));
    expect((await busy.s.begin({ id: 'r2', trigger: 'manual', startedAt: 'x', buildCommit: null })).kind).toBe('busy');
    const fresh = store((_u, init) => (init.method === 'POST' ? Response.json([{ id: 'r2' }], { status: 201 }) : Response.json([])));
    expect((await fresh.s.begin({ id: 'r2', trigger: 'cron', startedAt: '2026-11-01T19:00:00Z', buildCommit: 'abc' })).kind).toBe('started');
    const post = fresh.calls.find(c => c.init.method === 'POST')!;
    expect(String(post.init.body)).toContain('"status":"running"');
    expect((post.init.headers as Record<string, string>).Prefer).toContain('ignore-duplicates');
  });
  it('finish only updates a still-running row and truncates the error', async () => {
    const { s, calls } = store(() => new Response(null, { status: 204 }));
    await s.finish('r1', { status: 'failure', finishedAt: '2026-11-01T19:02:00Z', errorMessage: 'x'.repeat(500) });
    expect(calls[0]!.url).toContain('status=eq.running');
    expect(JSON.parse(String(calls[0]!.init.body)).error_message).toHaveLength(300);
  });
  it('reads the last run and the last success', async () => {
    let n = 0;
    const { s } = store(() => Response.json(n++ === 0 ? [row({ id: 'r9', status: 'failure', error_message: 'CONFLICT' })] : [row()]));
    const status = await s.status();
    expect(status.lastRun).toMatchObject({ id: 'r9', status: 'failure', errorMessage: 'CONFLICT' });
    expect(status.lastSuccess).toMatchObject({ id: 'r1', status: 'success' });
  });
  it('a missing table is a configuration error, not a crash', async () => {
    const { s } = store(() => new Response('{}', { status: 404 }));
    await expect(s.status()).rejects.toMatchObject({ code: 'CONFIG_MISSING' });
  });
});
