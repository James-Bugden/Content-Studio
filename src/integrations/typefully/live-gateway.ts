import 'server-only';
import type { Capability } from '@/domain/capability';
import type { Platform, TypefullyStatus } from '@/domain/enums';
import { AppError, type ErrorCode } from '@/domain/errors';
import { emit } from '@/observability/events';
import type {
  TypefullyCreateInput,
  TypefullyDraft,
  TypefullyGateway,
  TypefullyMetricKey,
  TypefullyPlatformView,
  TypefullyPublication,
} from '@/application/ports';

/**
 * Typefully API v2 adapter (CS-015/016). Facts and unverified points are recorded
 * in docs/implementation/typefully-api.md; this file follows that page.
 *
 * - Bearer auth, base `https://api.typefully.com/v2`, everything scoped to one
 *   social set.
 * - 20 s timeout per request. Reads retry at most twice on PROVIDER_UNAVAILABLE;
 *   writes never retry (a lost create is reconciled by the service instead).
 * - Errors are typed. A provider body is never parsed into an error, logged or
 *   returned: only the HTTP status and rate-limit timing survive.
 * - The API has no idempotency key. The key is stored as a marker in the draft's
 *   notes (`scratchpad_text`) so a retried operation can find its own draft.
 */
export const TYPEFULLY_BASE_URL = 'https://api.typefully.com';
export const TYPEFULLY_TIMEOUT_MS = 20_000;
/** Multi-post threads are joined with this separator when read as one text. */
export const THREAD_SEPARATOR = '\n\n\n\n';

const PLATFORM_KEY: Record<Platform, 'x' | 'linkedin' | 'threads'> = { X: 'x', LinkedIn: 'linkedin', Threads: 'threads' };
const PLATFORM_ORDER: Platform[] = ['X', 'LinkedIn', 'Threads'];
const STATUS: Record<string, TypefullyStatus> = {
  draft: 'Typefully Draft',
  planned: 'Planned',
  scheduled: 'Scheduled',
  publishing: 'Scheduled',
  published: 'Published',
  error: 'Error',
};
const PAGE_LIMIT = 50;
const MAX_LIST_PAGES = 20;
const MARKER_PAGES = 2;
const MARKER_DETAIL_FETCHES = 10;

export function idempotencyMarker(key: string): string {
  return `[cs-idem:${key}]`;
}
const MARKER = /\[cs-idem:([A-Za-z0-9_-]{8,80})\]/;

type RawPost = { text?: unknown };
type RawPlatform = { enabled?: unknown; posts?: unknown } | null | undefined;
export type RawDraft = Record<string, unknown> & {
  id?: unknown;
  status?: unknown;
  scheduled_date?: unknown;
  published_at?: unknown;
  updated_at?: unknown;
  scratchpad_text?: unknown;
  platforms?: Record<string, RawPlatform> | null;
};

export type LiveTypefullyOptions = {
  apiKey: string;
  socialSetId: string;
  fetch?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
  maxReadRetries?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
};

type RequestOptions = { query?: Record<string, string | number | boolean>; body?: unknown; read: boolean; op: string };

export class LiveTypefullyGateway implements TypefullyGateway {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxReadRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => Date;

  constructor(private readonly options: LiveTypefullyOptions) {
    if (!options.apiKey.trim() || !options.socialSetId.trim()) throw new AppError('CONFIG_MISSING', { provider: 'typefully' });
    this.fetchImpl = options.fetch ?? fetch;
    this.baseUrl = (options.baseUrl ?? TYPEFULLY_BASE_URL).replace(/\/$/, '');
    this.timeoutMs = options.timeoutMs ?? TYPEFULLY_TIMEOUT_MS;
    this.maxReadRetries = options.maxReadRetries ?? 2;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = options.now ?? (() => new Date());
  }

  capability(): Capability {
    return { provider: 'typefully', mode: 'live', state: 'ready' };
  }

  private path(suffix: string): string {
    return `/v2/social-sets/${encodeURIComponent(this.options.socialSetId)}${suffix}`;
  }

  // ------------------------------------------------------------------ HTTP

  private async request<T>(method: string, path: string, opts: RequestOptions): Promise<T> {
    let attempt = 0;
    for (;;) {
      try {
        return await this.once<T>(method, path, opts, attempt);
      } catch (error) {
        const retryable = opts.read && error instanceof AppError && error.code === 'PROVIDER_UNAVAILABLE' && attempt < this.maxReadRetries;
        if (!retryable) throw error;
        attempt += 1;
        await this.sleep(250 * 2 ** (attempt - 1));
      }
    }
  }

  private async once<T>(method: string, path: string, opts: RequestOptions, retries: number): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, String(v));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const started = performance.now();
    const base = { name: `typefully.http.${opts.op}`, adapter: 'typefully' as const, retries };
    let res: Response;
    try {
      res = await this.fetchImpl(url.toString(), {
        method,
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          Accept: 'application/json',
          ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
        signal: controller.signal,
      });
    } catch {
      clearTimeout(timer);
      const timedOut = controller.signal.aborted;
      emit({ ...base, outcome: 'error', code: 'PROVIDER_UNAVAILABLE', latencyMs: performance.now() - started, facts: { timeout: timedOut, rateLimited: false } });
      throw new AppError('PROVIDER_UNAVAILABLE', { provider: 'typefully', reason: timedOut ? 'timeout' : 'network' });
    }
    clearTimeout(timer);
    const latencyMs = performance.now() - started;
    if (!res.ok) {
      // The provider body is drained and discarded: it never reaches a log or a caller.
      await res.body?.cancel().catch(() => undefined);
      const code = mapStatus(res.status);
      const retryAfterSeconds = code === 'RATE_LIMITED' ? retryAfter(res.headers, this.now()) : undefined;
      emit({
        ...base,
        outcome: code === 'CONFLICT' ? 'conflict' : 'error',
        code,
        httpStatus: res.status,
        latencyMs,
        facts: { rateLimited: code === 'RATE_LIMITED', ...(retryAfterSeconds !== undefined ? { retryAfterS: retryAfterSeconds } : {}) },
      });
      throw new AppError(code, { provider: 'typefully', httpStatus: res.status, ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}) });
    }
    emit({ ...base, outcome: 'ok', httpStatus: res.status, latencyMs, facts: { rateLimited: false } });
    if (res.status === 204) return undefined as T;
    try {
      return (await res.json()) as T;
    } catch {
      throw new AppError('PROVIDER_UNAVAILABLE', { provider: 'typefully', reason: 'unreadable_response' });
    }
  }

  // ------------------------------------------------------------------ reads

  private async fetchDraft(id: string): Promise<RawDraft> {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new AppError('VALIDATION_FAILED', { reason: 'draft_id' });
    return this.request<RawDraft>('GET', this.path(`/drafts/${encodeURIComponent(id)}`), {
      query: { exclude_comment_markers: true },
      read: true,
      op: 'get_draft',
    });
  }

  async getDraft(id: string): Promise<TypefullyDraft> {
    return toDraft(await this.fetchDraft(id));
  }

  private async page(query: Record<string, string | number>, op: string): Promise<{ results: RawDraft[]; next: boolean }> {
    const body = await this.request<{ results?: unknown; next?: unknown }>('GET', this.path('/drafts'), { query, read: true, op });
    const results = Array.isArray(body?.results) ? (body.results as RawDraft[]) : [];
    return { results, next: typeof body?.next === 'string' && body.next !== '' };
  }

  async listDrafts(q: { platform: Platform; from: string; to: string }): Promise<TypefullyDraft[]> {
    const from = Date.parse(q.from);
    const to = Date.parse(q.to);
    if (Number.isNaN(from) || Number.isNaN(to) || from > to) throw new AppError('VALIDATION_FAILED', { reason: 'window' });
    const out: TypefullyDraft[] = [];
    // No documented date filter: scan newest scheduled first and stop once past the window.
    for (let p = 0; p < MAX_LIST_PAGES; p += 1) {
      const { results, next } = await this.page({ order_by: '-scheduled_date', limit: PAGE_LIMIT, offset: p * PAGE_LIMIT }, 'list_drafts');
      let passed = false;
      for (const raw of results) {
        const at = typeof raw.scheduled_date === 'string' ? Date.parse(raw.scheduled_date) : NaN;
        if (Number.isNaN(at)) continue;
        if (at < from) {
          passed = true;
          continue;
        }
        if (at > to) continue;
        if (!enabledPlatforms(raw).includes(q.platform)) continue;
        // A list item may omit per-platform text; fetch the full draft rather than guess.
        out.push(hasText(raw, q.platform) ? toDraft(raw) : await this.getDraft(String(raw.id)));
      }
      if (!next || passed) return out;
    }
    // Stopping early could hide a candidate and allow a duplicate create.
    throw new AppError('PROVIDER_UNAVAILABLE', { provider: 'typefully', reason: 'candidate_scan_truncated' });
  }

  async findByIdempotencyKey(key: string): Promise<TypefullyDraft | null> {
    let detailFetches = 0;
    for (let p = 0; p < MARKER_PAGES; p += 1) {
      const { results, next } = await this.page({ order_by: '-created_at', limit: PAGE_LIMIT, offset: p * PAGE_LIMIT }, 'find_marker');
      for (const raw of results) {
        let notes = raw.scratchpad_text;
        if (notes === undefined && detailFetches < MARKER_DETAIL_FETCHES) {
          detailFetches += 1;
          notes = (await this.fetchDraft(String(raw.id))).scratchpad_text;
        }
        if (typeof notes === 'string' && MARKER.exec(notes)?.[1] === key) return this.getDraft(String(raw.id));
      }
      if (!next) break;
    }
    return null;
  }

  // ------------------------------------------------------------------ writes

  async createDraft(input: TypefullyCreateInput): Promise<TypefullyDraft> {
    const k = PLATFORM_KEY[input.platform];
    const timing = input.timing ?? 'plan';
    const body = {
      platforms: { [k]: { enabled: true, posts: [{ text: input.text }] } },
      scratchpad_text: idempotencyMarker(input.idempotencyKey),
      ...(input.scheduleAt ? (timing === 'publish' ? { publish_at: input.scheduleAt } : { plan_at: input.scheduleAt }) : {}),
    };
    const raw = await this.request<RawDraft>('POST', this.path('/drafts'), { body, read: false, op: 'create_draft' });
    const draft = toDraft(raw, input.platform);
    return hasText(raw, input.platform) ? draft : { ...draft, text: input.text, perPlatform: { ...draft.perPlatform, [input.platform]: { ...(draft.perPlatform[input.platform] ?? {}), text: input.text } } };
  }

  async updateDraft(id: string, patch: { text: string; expectedUpdatedAt: string }): Promise<TypefullyDraft> {
    // No conditional update exists: re-read and compare immediately before writing.
    const current = toDraft(await this.fetchDraft(id));
    if (Date.parse(current.updatedAt) !== Date.parse(patch.expectedUpdatedAt)) {
      throw new AppError('CONFLICT', { provider: 'typefully', reason: 'draft_changed' });
    }
    if (current.platforms.length !== 1) throw new AppError('CONFLICT', { provider: 'typefully', reason: 'multi_platform_draft' });
    const k = PLATFORM_KEY[current.platform];
    const raw = await this.request<RawDraft>('PATCH', this.path(`/drafts/${encodeURIComponent(id)}`), {
      query: { exclude_comment_markers: true },
      body: { platforms: { [k]: { enabled: true, posts: [{ text: patch.text }] } } },
      read: false,
      op: 'update_draft',
    });
    return toDraft(raw, current.platform);
  }

  async getPublication(id: string, platform?: Platform): Promise<TypefullyPublication> {
    const draft = toDraft(await this.fetchDraft(id));
    const p = platform ?? draft.platform;
    const view = draft.perPlatform[p];
    if (!view) throw new AppError('NOT_FOUND', { provider: 'typefully', reason: 'platform_not_enabled' });
    const publishedAt = view.publishedAt ?? (draft.platforms.length === 1 ? draft.publishedAt : undefined);
    const pub: TypefullyPublication = {
      status: draft.status,
      ...(publishedAt ? { publishedAt } : {}),
      ...(view.url ? { url: view.url } : {}),
      finalText: view.text,
    };
    // Post analytics are documented for X only; other platforms stay blank.
    if (p !== 'X' || draft.status !== 'Published' || !publishedAt) return pub;
    const metrics = await this.xMetrics(id, view.url, publishedAt);
    return metrics ? { ...pub, metrics } : pub;
  }

  private async xMetrics(id: string, url: string | undefined, publishedAt: string): Promise<Partial<Record<TypefullyMetricKey, number>> | null> {
    const day = 86_400_000;
    const at = Date.parse(publishedAt);
    const start = new Date(at - day).toISOString().slice(0, 10);
    const end = new Date(at + day).toISOString().slice(0, 10);
    const body = await this.request<{ results?: unknown }>('GET', this.path('/analytics/x/posts'), {
      query: { start_date: start, end_date: end, limit: 100 },
      read: true,
      op: 'x_post_metrics',
    });
    const rows = Array.isArray(body?.results) ? (body.results as Record<string, unknown>[]) : [];
    const row = rows.find((r) => (r.draft_id !== undefined && r.draft_id !== null && String(r.draft_id) === id) || (url && r.url === url));
    if (!row) return null;
    return mapXMetrics(row.metrics);
  }
}

// ------------------------------------------------------------------ mapping

export function mapStatus(status: number): ErrorCode {
  if (status === 429) return 'RATE_LIMITED';
  if (status === 401) return 'CONFIG_MISSING';
  if (status === 402 || status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 400 || status === 422) return 'VALIDATION_FAILED';
  if (status >= 500) return 'PROVIDER_UNAVAILABLE';
  return 'UNKNOWN';
}

/** Seconds until retry: `Retry-After` when sent, else the earliest documented rate-limit reset (Unix seconds). */
export function retryAfter(headers: Headers, now: Date): number | undefined {
  const ra = headers.get('retry-after');
  if (ra) {
    const secs = Number(ra);
    if (Number.isFinite(secs) && secs >= 0) return Math.ceil(secs);
    const at = Date.parse(ra);
    if (!Number.isNaN(at)) return Math.max(0, Math.ceil((at - now.getTime()) / 1000));
  }
  const resets = ['x-ratelimit-user-reset', 'x-ratelimit-socialset-reset']
    .map((h) => Number(headers.get(h)))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (resets.length === 0) return undefined;
  const remaining = headers.get('x-ratelimit-user-remaining') === '0' || headers.get('x-ratelimit-socialset-remaining') === '0';
  const soonest = remaining ? Math.max(...resets) : Math.min(...resets);
  return Math.max(0, Math.ceil(soonest - now.getTime() / 1000));
}

function rawPlatform(raw: RawDraft, p: Platform): RawPlatform {
  return raw.platforms?.[PLATFORM_KEY[p]] ?? null;
}

function enabledPlatforms(raw: RawDraft): Platform[] {
  return PLATFORM_ORDER.filter((p) => rawPlatform(raw, p)?.enabled === true || raw[`${PLATFORM_KEY[p]}_post_enabled`] === true);
}

function hasText(raw: RawDraft, p: Platform): boolean {
  const posts = rawPlatform(raw, p)?.posts;
  return Array.isArray(posts) && posts.every((x: RawPost) => typeof x?.text === 'string');
}

function textOf(raw: RawDraft, p: Platform): string {
  const posts = rawPlatform(raw, p)?.posts;
  return Array.isArray(posts) ? (posts as RawPost[]).map((x) => (typeof x?.text === 'string' ? x.text : '')).join(THREAD_SEPARATOR) : '';
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined;
}

export function toDraft(raw: RawDraft, fallbackPlatform?: Platform): TypefullyDraft {
  const id = typeof raw.id === 'number' || typeof raw.id === 'string' ? String(raw.id) : '';
  const status = typeof raw.status === 'string' ? STATUS[raw.status] : undefined;
  const updatedAt = str(raw.updated_at);
  if (!id || !status || !updatedAt) throw new AppError('UNKNOWN', { provider: 'typefully', reason: 'unrecognised_draft_shape' });
  let platforms = enabledPlatforms(raw);
  if (platforms.length === 0 && fallbackPlatform) platforms = [fallbackPlatform];
  if (platforms.length === 0) throw new AppError('UNKNOWN', { provider: 'typefully', reason: 'no_supported_platform' });
  const perPlatform: Partial<Record<Platform, TypefullyPlatformView>> = {};
  for (const p of platforms) {
    const k = PLATFORM_KEY[p];
    const url = str(raw[`${k}_published_url`]);
    const publishedAt = str(raw[`${k}_post_published_at`]);
    perPlatform[p] = { text: textOf(raw, p), ...(url ? { url } : {}), ...(publishedAt ? { publishedAt } : {}) };
  }
  const primary = platforms[0]!;
  const view = perPlatform[primary]!;
  const marker = typeof raw.scratchpad_text === 'string' ? MARKER.exec(raw.scratchpad_text)?.[1] : undefined;
  const scheduledAt = str(raw.scheduled_date);
  const publishedAt = view.publishedAt ?? str(raw.published_at);
  return {
    id,
    platform: primary,
    platforms,
    text: view.text,
    status,
    ...(scheduledAt ? { scheduledAt } : {}),
    updatedAt,
    ...(publishedAt ? { publishedAt } : {}),
    ...(view.url ? { url: view.url } : {}),
    perPlatform,
    ...(marker ? { idempotencyKey: marker } : {}),
  };
}

function count(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
}

/**
 * X post metrics as documented: `impressions`, `engagement.likes`,
 * `engagement.shares`, `engagement.comments`, optional `engagement.saves`.
 * There is no per-post follower metric, so `newFollowers` is never set.
 */
export function mapXMetrics(metrics: unknown): Partial<Record<TypefullyMetricKey, number>> {
  const m = (metrics ?? {}) as { impressions?: unknown; engagement?: Record<string, unknown> };
  const e = m.engagement ?? {};
  const out: Partial<Record<TypefullyMetricKey, number>> = {};
  const set = (k: TypefullyMetricKey, v: unknown) => {
    const n = count(v);
    if (n !== undefined) out[k] = n;
  };
  set('views', m.impressions);
  set('likes', e.likes);
  set('reposts', e.shares);
  set('replies', e.comments);
  set('bookmarks', e.saves);
  return out;
}
