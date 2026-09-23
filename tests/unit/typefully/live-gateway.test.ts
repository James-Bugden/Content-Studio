import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LiveTypefullyGateway, idempotencyMarker, mapStatus, retryAfter } from '@/integrations/typefully/live-gateway';
import { UnconfiguredTypefullyGateway } from '@/integrations/typefully/fake-gateway';
import { createTypefullyGateway } from '@/application/container';
import { AppError } from '@/domain/errors';
import { setTelemetrySink, type TelemetryEvent } from '@/observability/events';

/**
 * Contract tests for the live Typefully adapter against a scripted fetch. No
 * network, no real key or social set: every request is captured and answered
 * with synthetic JSON shaped like the documented v2 responses.
 */
type Call = { url: string; init?: RequestInit };
const KEY = 'synthetic-typefully-key';
const SET = 'SYNTH_SET_1';
const BASE = `https://api.typefully.com/v2/social-sets/${SET}`;
const SENTINEL = 'CS_PROVIDER_BODY_SENTINEL';

let events: (TelemetryEvent & { at: string })[];
beforeEach(() => {
  events = [];
  setTelemetrySink((e) => events.push(e));
});
afterEach(() => setTelemetrySink(null));

function scripted(responses: ((call: Call) => Response | Promise<Response>)[]) {
  const calls: Call[] = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    const call = { url: String(url), init };
    calls.push(call);
    const next = responses.shift();
    if (!next) throw new Error(`unexpected request ${call.url}`);
    return next(call);
  }) as typeof fetch;
  return { impl, calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => () => new Response(JSON.stringify(body), { status, headers });

function gateway(impl: typeof fetch, extra: Partial<ConstructorParameters<typeof LiveTypefullyGateway>[0]> = {}) {
  return new LiveTypefullyGateway({ apiKey: KEY, socialSetId: SET, fetch: impl, sleep: async () => undefined, now: () => new Date('2026-09-30T00:00:00Z'), ...extra });
}

const rawX = (over: Record<string, unknown> = {}) => ({
  id: 4242,
  status: 'scheduled',
  scheduled_date: '2026-10-03T00:00:00Z',
  published_at: null,
  updated_at: '2026-09-29T00:00:00Z',
  scratchpad_text: null,
  x_post_enabled: true,
  x_published_url: null,
  platforms: { x: { enabled: true, posts: [{ text: 'First post  ' }, { text: '第二則 🙂' }] }, linkedin: null, threads: null },
  ...over,
});

describe('requests', () => {
  it('getDraft: bearer auth, social-set path, comment markers excluded, thread posts joined exactly', async () => {
    const { impl, calls } = scripted([json(rawX())]);
    const d = await gateway(impl).getDraft('4242');
    expect(calls[0]!.url).toBe(`${BASE}/drafts/4242?exclude_comment_markers=true`);
    expect((calls[0]!.init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    expect(d).toMatchObject({ id: '4242', platform: 'X', platforms: ['X'], status: 'Scheduled', text: 'First post  \n\n\n\n第二則 🙂', scheduledAt: '2026-10-03T00:00:00Z' });
  });

  it('createDraft: one platform, exact text, marker in notes, plan_at by default, publish_at on request, no idempotency header', async () => {
    const { impl, calls } = scripted([json(rawX({ status: 'planned' }), 201), json(rawX(), 201)]);
    const gw = gateway(impl);
    await gw.createDraft({ platform: 'X', text: 'Exact  text\r\n', scheduleAt: '2026-10-03T08:00:00+08:00', idempotencyKey: 'csabcdef0123456789' });
    await gw.createDraft({ platform: 'X', text: 'x', scheduleAt: '2026-10-03T08:00:00+08:00', timing: 'publish', idempotencyKey: 'csabcdef0123456789' });
    expect(calls[0]!.url).toBe(`${BASE}/drafts`);
    expect(calls[0]!.init?.method).toBe('POST');
    const body = JSON.parse(String(calls[0]!.init?.body));
    expect(body).toEqual({
      platforms: { x: { enabled: true, posts: [{ text: 'Exact  text\r\n' }] } },
      scratchpad_text: idempotencyMarker('csabcdef0123456789'),
      plan_at: '2026-10-03T08:00:00+08:00',
    });
    expect(JSON.parse(String(calls[1]!.init?.body)).publish_at).toBe('2026-10-03T08:00:00+08:00');
    expect(Object.keys(calls[0]!.init?.headers as Record<string, string>).map((h) => h.toLowerCase())).not.toContain('idempotency-key');
  });

  it('listDrafts: scans by scheduled date, keeps the window and platform, fetches full text when the list omits it', async () => {
    const page = {
      results: [
        rawX({ id: 1, scheduled_date: '2026-10-03T03:00:00Z' }), // after window
        rawX({ id: 2 }), // in window, has text
        { ...rawX({ id: 3, scheduled_date: '2026-10-03T00:30:00Z' }), platforms: undefined }, // in window, no text in list
        rawX({ id: 4, x_post_enabled: false, platforms: { linkedin: { enabled: true, posts: [{ text: 'li' }] } } }), // other platform
        rawX({ id: 5, scheduled_date: '2026-10-02T20:00:00Z' }), // before window: stop
      ],
      next: `${BASE}/drafts?offset=50`,
    };
    const { impl, calls } = scripted([json(page), json(rawX({ id: 3, scheduled_date: '2026-10-03T00:30:00Z' }))]);
    const found = await gateway(impl).listDrafts({ platform: 'X', from: '2026-10-02T22:30:00Z', to: '2026-10-03T01:30:00Z' });
    expect(found.map((d) => d.id)).toEqual(['2', '3']);
    expect(calls[0]!.url).toContain('order_by=-scheduled_date');
    expect(calls).toHaveLength(2);
  });

  it('findByIdempotencyKey: finds the marker among recent drafts', async () => {
    const marked = rawX({ id: 77, scratchpad_text: `notes ${idempotencyMarker('cs0011223344556677')}` });
    const { impl, calls } = scripted([json({ results: [rawX({ id: 76 }), marked], next: null }), json(marked)]);
    const d = await gateway(impl).findByIdempotencyKey('cs0011223344556677');
    expect(d?.id).toBe('77');
    expect(d?.idempotencyKey).toBe('cs0011223344556677');
    expect(calls[0]!.url).toContain('order_by=-created_at');
  });

  it('updateDraft refuses without a PATCH when Typefully changed since it was read', async () => {
    const { impl, calls } = scripted([json(rawX({ updated_at: '2026-09-29T05:00:00Z' }))]);
    await expect(gateway(impl).updateDraft('4242', { text: 'new', expectedUpdatedAt: '2026-09-29T00:00:00Z' })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(calls).toHaveLength(1);
  });

  it('updateDraft PATCHes the draft platform when unchanged', async () => {
    const { impl, calls } = scripted([json(rawX()), json(rawX({ updated_at: '2026-09-30T00:00:00Z', platforms: { x: { enabled: true, posts: [{ text: 'new' }] } } }))]);
    const d = await gateway(impl).updateDraft('4242', { text: 'new', expectedUpdatedAt: '2026-09-29T00:00:00.000Z' });
    expect(calls[1]!.init?.method).toBe('PATCH');
    expect(JSON.parse(String(calls[1]!.init?.body))).toEqual({ platforms: { x: { enabled: true, posts: [{ text: 'new' }] } } });
    expect(d.text).toBe('new');
  });
});

describe('publication and metrics matrix', () => {
  const published = rawX({ status: 'published', published_at: '2026-10-03T00:00:05Z', x_published_url: 'https://x.com/example/status/1', x_post_published_at: '2026-10-03T00:00:05Z' });

  it('X: impressions/likes/shares/comments/saves map to views/likes/reposts/replies/bookmarks; followers never', async () => {
    const analytics = { results: [{ draft_id: 4242, url: 'https://x.com/example/status/1', metrics: { impressions: 900, engagement: { likes: 0, shares: 3, comments: 1, quotes: 2, profile_clicks: 5, total: 11 } } }] };
    const { impl, calls } = scripted([json(published), json(analytics)]);
    const pub = await gateway(impl).getPublication('4242', 'X');
    expect(calls[1]!.url).toBe(`${BASE}/analytics/x/posts?start_date=2026-10-02&end_date=2026-10-04&limit=100`);
    expect(pub).toEqual({ status: 'Published', publishedAt: '2026-10-03T00:00:05Z', url: 'https://x.com/example/status/1', finalText: 'First post  \n\n\n\n第二則 🙂', metrics: { views: 900, likes: 0, reposts: 3, replies: 1 } });
  });

  it('Threads and LinkedIn: no analytics call, no metrics', async () => {
    const th = rawX({ status: 'published', x_post_enabled: false, threads_post_enabled: true, threads_published_url: 'https://www.threads.net/@example/post/SYNTH', platforms: { threads: { enabled: true, posts: [{ text: '串文' }] } } });
    const { impl, calls } = scripted([json(th)]);
    const pub = await gateway(impl).getPublication('4242', 'Threads');
    expect(calls).toHaveLength(1);
    expect(pub.metrics).toBeUndefined();
    expect(pub.finalText).toBe('串文');
  });

  it('a combined X+Threads draft exposes both platforms and per-platform text', async () => {
    const multi = rawX({ threads_post_enabled: true, platforms: { x: { enabled: true, posts: [{ text: 'en' }] }, threads: { enabled: true, posts: [{ text: '中' }] } } });
    const { impl } = scripted([json(multi)]);
    const d = await gateway(impl).getDraft('4242');
    expect(d.platforms).toEqual(['X', 'Threads']);
    expect(d.perPlatform.Threads?.text).toBe('中');
  });

  it('an unrecognised provider status is UNKNOWN, never guessed', async () => {
    const { impl } = scripted([json(rawX({ status: 'archived' }))]);
    await expect(gateway(impl).getDraft('4242')).rejects.toMatchObject({ code: 'UNKNOWN' });
  });
});

describe('error mapping, retries and redaction', () => {
  const body = { error: { code: 'x', message: `${SENTINEL} secret detail` } };

  it.each([
    [401, 'CONFIG_MISSING'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [409, 'CONFLICT'],
    [422, 'VALIDATION_FAILED'],
  ])('HTTP %i maps to %s without the provider body', async (status, code) => {
    const { impl } = scripted([json(body, status)]);
    const err = (await gateway(impl).getDraft('1').catch((e: unknown) => e)) as AppError;
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe(code);
    expect(JSON.stringify({ m: err.message, d: err.details })).not.toContain(SENTINEL);
    expect(JSON.stringify(events)).not.toContain(SENTINEL);
  });

  it('429 is RATE_LIMITED with Retry-After recorded, and not retried', async () => {
    const { impl, calls } = scripted([json(body, 429, { 'Retry-After': '30' })]);
    await expect(gateway(impl).getDraft('1')).rejects.toMatchObject({ code: 'RATE_LIMITED', details: { retryAfterSeconds: 30, httpStatus: 429 } });
    expect(calls).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ name: 'typefully.http.get_draft', code: 'RATE_LIMITED', httpStatus: 429, facts: { rateLimited: true, retryAfterS: 30 } });
  });

  it('rate-limit reset headers are used when Retry-After is absent', () => {
    const now = new Date('2026-09-30T00:00:00Z');
    const headers = new Headers({ 'X-RateLimit-User-Reset': String(now.getTime() / 1000 + 45), 'X-RateLimit-User-Remaining': '0' });
    expect(retryAfter(headers, now)).toBe(45);
    expect(retryAfter(new Headers(), now)).toBeUndefined();
    expect(mapStatus(503)).toBe('PROVIDER_UNAVAILABLE');
  });

  it('5xx on a read retries twice then fails; on a create it is never retried', async () => {
    const r = scripted([json(body, 502), json(body, 503), json(body, 500)]);
    await expect(gateway(r.impl).getDraft('1')).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    expect(r.calls).toHaveLength(3);
    const w = scripted([json(body, 503)]);
    await expect(gateway(w.impl).createDraft({ platform: 'X', text: 't', idempotencyKey: 'cs0000000000000000' })).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    expect(w.calls).toHaveLength(1);
  });

  it('a read that recovers on retry succeeds', async () => {
    const r = scripted([json(body, 503), json(rawX())]);
    expect((await gateway(r.impl).getDraft('4242')).id).toBe('4242');
  });

  it('times out with PROVIDER_UNAVAILABLE', async () => {
    const hang = ((_url: string, init?: RequestInit) =>
      new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))) as typeof fetch;
    await expect(gateway(hang, { timeoutMs: 5, maxReadRetries: 0 }).getDraft('1')).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE', details: { reason: 'timeout' } });
  });

  it('never puts the API key in events or errors', async () => {
    const { impl } = scripted([json(body, 401)]);
    const err = await gateway(impl).getDraft('1').catch((e: unknown) => e);
    expect(JSON.stringify(events) + JSON.stringify(err)).not.toContain(KEY);
  });
});

describe('configuration', () => {
  it('live mode without a key is not_configured and every call is CONFIG_MISSING', async () => {
    const gw = createTypefullyGateway({ CS_DATA_MODE: 'live' } as Parameters<typeof createTypefullyGateway>[0]);
    expect(gw).toBeInstanceOf(UnconfiguredTypefullyGateway);
    expect(gw.capability().state).toBe('not_configured');
    await expect(gw.getDraft('1')).rejects.toMatchObject({ code: 'CONFIG_MISSING' });
    await expect(gw.createDraft({ platform: 'X', text: 't', idempotencyKey: 'cs0000000000000000' })).rejects.toMatchObject({ code: 'CONFIG_MISSING' });
  });

  it('live mode with a key and social set uses the live adapter; fake mode never does', () => {
    expect(createTypefullyGateway({ CS_DATA_MODE: 'live', TYPEFULLY_API_KEY: KEY, TYPEFULLY_SOCIAL_SET_ID: SET } as Parameters<typeof createTypefullyGateway>[0])).toBeInstanceOf(LiveTypefullyGateway);
    expect(createTypefullyGateway({ CS_DATA_MODE: 'fake', TYPEFULLY_API_KEY: KEY, TYPEFULLY_SOCIAL_SET_ID: SET } as Parameters<typeof createTypefullyGateway>[0]).capability().mode).toBe('fake');
  });
});
