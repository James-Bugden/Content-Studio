import 'server-only';
import type { ContentCollection, ContentDb, ContentPostRow, ContentScheduleRow, ContentSettingRow, ContentSummaryRow, ContentTarget, ContentWrite, ContentWriteResult } from '@/application/content-db';
import { z } from 'zod';
import { AppError, isAppError } from '@/domain/errors';

export type SupabaseContentDbOptions = { url: string; serviceKey: string; fetch?: typeof fetch; timeoutMs?: number };

/**
 * Server-only PostgREST client. Explicit range continuation also handles hosted row caps.
 * PostgREST order has no COLLATE modifier: DB-2 pins every text sort column to
 * COLLATE "C" in SQL, including the derived views, so all orders below inherit it.
 */
export class SupabaseContentDb implements ContentDb {
  readonly mode = 'live' as const;
  private readonly base: string;
  constructor(private readonly options: SupabaseContentDbOptions) {
    if (!/^(?:https:\/\/[a-z0-9-]+\.supabase\.co|http:\/\/(?:127\.0\.0\.1|localhost):54321)\/?$/i.test(options.url) || options.serviceKey.trim().length < 20) {
      throw new AppError('CONFIG_MISSING', { provider: 'db' });
    }
    this.base = options.url.replace(/\/$/, '');
  }
  private async select<T>(table: string, params: Record<string, string>, firstOnly = false): Promise<T[]> {
    const rows: T[] = [];
    for (;;) {
      try {
        const query = new URLSearchParams({ select: '*', ...params, offset: String(rows.length), limit: firstOnly ? '1' : '1000' });
        const response = await (this.options.fetch ?? fetch)(`${this.base}/rest/v1/content_studio_${table}?${query}`, {
          method: 'GET', cache: 'no-store', signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
          headers: { apikey: this.options.serviceKey, Authorization: `Bearer ${this.options.serviceKey}`, ...(!firstOnly ? { Prefer: 'count=exact' } : {}) },
        });
        if (!response.ok) throw new AppError(response.status === 429 ? 'RATE_LIMITED' : 'PROVIDER_UNAVAILABLE', { provider: 'db', httpStatus: response.status });
        const page: unknown = await response.json();
        if (!Array.isArray(page) || page.some(row => row === null || typeof row !== 'object' || Array.isArray(row))) throw new AppError('SCHEMA_DRIFT', { provider: 'db', kind: 'response' });
        rows.push(...page as T[]);
        if (firstOnly) return rows;
        const total = response.headers.get('content-range')?.split('/')[1];
        if (total && /^\d+$/.test(total) && rows.length >= Number(total)) return rows;
        if (page.length === 0) {
          if (total && /^\d+$/.test(total) && rows.length < Number(total)) throw new AppError('PROVIDER_UNAVAILABLE', { provider: 'db', reason: 'incomplete_read' });
          return rows;
        }
      } catch (error) {
        if (isAppError(error)) throw error;
        throw new AppError('PROVIDER_UNAVAILABLE', { provider: 'db', reason: 'network' });
      }
    }
  }
  private async rpc(name: string, params: Record<string, unknown>): Promise<ContentWriteResult> {
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await (this.options.fetch ?? fetch)(`${this.base}/rest/v1/rpc/content_studio_${name}`, {
          method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
          headers: { apikey: this.options.serviceKey, Authorization: `Bearer ${this.options.serviceKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(params),
        });
        if (!response.ok) {
          const body: unknown = await response.json().catch(() => null);
          const sqlCode = body && typeof body === 'object' && 'code' in body ? body.code : null;
          // A fresh request starts a new transaction/snapshot; identity stays fixed.
          if ((sqlCode === '40001' || sqlCode === '23505') && attempt < 2) continue;
          throw new AppError(response.status === 429 ? 'RATE_LIMITED' : sqlCode === '42501' ? 'FORBIDDEN'
            : typeof sqlCode === 'string' && /^(22|23)/.test(sqlCode) && sqlCode !== '23505' ? 'VALIDATION_FAILED' : 'PROVIDER_UNAVAILABLE', { provider: 'db', httpStatus: response.status });
        }
        const parsed = writeResultSchema.safeParse(await response.json());
        if (!parsed.success) throw new AppError('SCHEMA_DRIFT', { provider: 'db', kind: 'mutation_response' });
        const result = parsed.data;
        const state = result.steps[0]!.state;
        const code = state === 'applied' || state === 'already_applied' ? null : state === 'stale' ? 'STALE_READ' : state === 'not_found' ? 'NOT_FOUND' : 'CONFLICT';
        if (result.code !== code || result.ok !== (code === null) || ((result.ok || state === 'stale') && result.revision === null)
          || (result.replayed && !result.ok)) throw new AppError('SCHEMA_DRIFT', { provider: 'db', kind: 'mutation_response' });
        return result;
      } catch (error) {
        if (isAppError(error)) throw error;
        throw new AppError('PROVIDER_UNAVAILABLE', { provider: 'db', reason: 'network' });
      }
    }
  }
  writeThrough(w: ContentWrite) { return this.rpc('write_through', { p_operation_id: w.operationId, p_patch_hash: w.patchHash, p_actor_hash: w.actorHash,
    p_target_kind: w.kind, p_target_id: w.id, p_expected_version: w.expectedVersion, p_row: w.data }); }
  applyPatch(w: ContentWrite) { return this.rpc('apply_patch', { p_operation_id: w.operationId, p_patch_hash: w.patchHash, p_actor_hash: w.actorHash,
    p_target_kind: w.kind, p_target_id: w.id, p_expected_version: w.expectedVersion, p_patch: w.data }); }
  insertQueueIdea(w: ContentWrite) { return this.rpc('insert_queue_idea', { p_operation_id: w.operationId, p_patch_hash: w.patchHash, p_actor_hash: w.actorHash, p_library_id: w.id, p_row: w.data }); }
  async mutationRow(kind: ContentTarget, id: string, version: string) {
    const history = () => this.select<{ before_image: ContentPostRow | ContentScheduleRow }>('row_history', {
      target_kind: `eq.${kind}`, target_id: `eq.${id}`, row_version_before: `eq.${version}`, order: 'history_id.asc',
    });
    const old = (await history())[0]?.before_image;
    if (old) return old;
    const row = kind === 'schedule' ? await this.getSchedule(id) : await this.getPost(kind, id);
    if (row && String(row.row_version) === version) return row;
    const raced = (await history())[0]?.before_image;
    if (raced) return raced;
    throw new AppError('PROVIDER_UNAVAILABLE', { provider: 'db', reason: 'revision_unavailable' });
  }
  async schemaVersion() { const rows = await this.select<{ version: unknown }>('schema_version', { singleton: 'eq.true' }); return rows.length === 1 ? rows[0]!.version : null; }
  async latestImportId() {
    const rows = await this.select<{ operation_id: unknown }>('import_runs', { select: 'operation_id', order: 'at.desc,operation_id.desc' }, true);
    if (!rows.length) return null;
    if (rows.length !== 1 || typeof rows[0]!.operation_id !== 'string' || !rows[0]!.operation_id) throw new AppError('SCHEMA_DRIFT', { provider: 'db', kind: 'import_identity' });
    return rows[0]!.operation_id;
  }
  listPosts(collection: ContentCollection | 'ready') {
    return this.select<ContentPostRow>(collection === 'ready' ? 'ready_queue' : 'posts', {
      ...(collection === 'ready' ? {} : { collection: `eq.${collection}` }), order: 'source_sheet_row.asc.nullslast,library_id.asc',
    });
  }
  async getPost(collection: ContentCollection, id: string) { return (await this.select<ContentPostRow>('posts', { collection: `eq.${collection}`, library_id: `eq.${id}`, order: 'library_id.asc' }))[0] ?? null; }
  listSchedule() { return this.select<ContentScheduleRow>('schedule', { order: 'date.asc,platform.asc,slot.asc,content_id.asc' }); }
  async getSchedule(id: string) { return (await this.select<ContentScheduleRow>('schedule', { content_id: `eq.${id}`, order: 'content_id.asc' }))[0] ?? null; }
  queueSummary() { return this.select<ContentSummaryRow>('queue_summary', { order: 'content_source.asc' }); }
  workflowSettings() { return this.select<ContentSettingRow>('workflow_settings', { order: 'source_sheet_row.asc.nullslast,setting.asc' }); }
}

const writeResultSchema = z.object({ ok: z.boolean(), code: z.enum(['CONFLICT', 'STALE_READ', 'NOT_FOUND']).nullable(),
  steps: z.array(z.object({ state: z.enum(['applied', 'already_applied', 'stale', 'not_found', 'conflict']), reason: z.string().optional() })).length(1),
  revision: z.union([z.number().int().positive().refine(Number.isSafeInteger), z.string().regex(/^[1-9]\d*$/)]).nullable(), replayed: z.boolean().optional() });
