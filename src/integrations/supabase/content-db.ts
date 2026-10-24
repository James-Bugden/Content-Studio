import 'server-only';
import type { ContentCollection, ContentDb, ContentPostRow, ContentScheduleRow, ContentSettingRow, ContentSummaryRow } from '@/application/content-db';
import { AppError, isAppError } from '@/domain/errors';

export type SupabaseContentDbOptions = { url: string; serviceKey: string; fetch?: typeof fetch; timeoutMs?: number };

/** Server-only GET client. Explicit range continuation also handles hosted row caps. */
export class SupabaseContentDb implements ContentDb {
  readonly mode = 'live' as const;
  private readonly base: string;
  constructor(private readonly options: SupabaseContentDbOptions) {
    if (!/^(?:https:\/\/[a-z0-9-]+\.supabase\.co|http:\/\/(?:127\.0\.0\.1|localhost):54321)\/?$/i.test(options.url) || options.serviceKey.trim().length < 20) {
      throw new AppError('CONFIG_MISSING', { provider: 'db' });
    }
    this.base = options.url.replace(/\/$/, '');
  }
  private async select<T>(table: string, params: Record<string, string>): Promise<T[]> {
    const rows: T[] = [];
    for (;;) {
      try {
        const query = new URLSearchParams({ select: '*', ...params, offset: String(rows.length), limit: '1000' });
        const response = await (this.options.fetch ?? fetch)(`${this.base}/rest/v1/content_studio_${table}?${query}`, {
          method: 'GET', cache: 'no-store', signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
          headers: { apikey: this.options.serviceKey, Authorization: `Bearer ${this.options.serviceKey}`, Prefer: 'count=exact' },
        });
        if (!response.ok) throw new AppError(response.status === 429 ? 'RATE_LIMITED' : 'PROVIDER_UNAVAILABLE', { provider: 'db', httpStatus: response.status });
        const page: unknown = await response.json();
        if (!Array.isArray(page) || page.some(row => row === null || typeof row !== 'object' || Array.isArray(row))) throw new AppError('SCHEMA_DRIFT', { provider: 'db', kind: 'response' });
        rows.push(...page as T[]);
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
  async schemaVersion() { const rows = await this.select<{ version: unknown }>('schema_version', { singleton: 'eq.true' }); return rows.length === 1 ? rows[0]!.version : null; }
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
