import 'server-only';
import { AppError, isAppError } from '@/domain/errors';
import type { BackupPageRequest, BackupRow, BackupRowSource } from '@/application/backup-ports';

const TABLE = /^[a-z][a-z0-9_]{0,62}$/;
const COLUMN = /^[a-z][a-z0-9_]{0,62}$/;
const SELECT = /^[a-z0-9_,*]{1,300}$/;

/** PostgREST filter value, always double-quoted so commas, parens and dots cannot change the filter. */
const quote = (value: unknown) => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/**
 * Keyset condition for "rows after `after`" in the given order, e.g. for (a, b)
 * ascending: or(a.gt.A, and(a.eq.A, b.gt.B)). Pure, so it is unit-tested.
 */
export function keysetFilter(order: readonly string[], desc: boolean, after: BackupRow): string {
  const op = desc ? 'lt' : 'gt';
  const terms = order.map((col, i) => {
    const eq = order.slice(0, i).map(c => `${c}.eq.${quote(after[c])}`);
    const cmp = `${col}.${op}.${quote(after[col])}`;
    return eq.length ? `and(${[...eq, cmp].join(',')})` : cmp;
  });
  return `(${terms.join(',')})`;
}

export type PostgrestBackupSourceOptions = { url: string; serviceKey: string; fetch?: typeof fetch; timeoutMs?: number };

/**
 * Service-role reads through PostgREST, one bounded page at a time. The caller
 * pages by primary key (keyset), so a concurrent write can neither skip nor
 * repeat a row the way OFFSET paging could.
 */
export class PostgrestBackupRowSource implements BackupRowSource {
  private readonly base: string;
  constructor(private readonly options: PostgrestBackupSourceOptions) {
    if (!/^(?:https:\/\/[a-z0-9-]+\.supabase\.co|http:\/\/(?:127\.0\.0\.1|localhost):54321)\/?$/i.test(options.url) || options.serviceKey.trim().length < 20) {
      throw new AppError('CONFIG_MISSING', { provider: 'db' });
    }
    this.base = options.url.replace(/\/$/, '');
  }

  private async get(table: string, query: URLSearchParams, extra: Record<string, string> = {}): Promise<Response> {
    if (!TABLE.test(table)) throw new AppError('VALIDATION_FAILED', { reason: 'backup_table' });
    try {
      const response = await (this.options.fetch ?? fetch)(`${this.base}/rest/v1/${table}?${query}`, {
        method: 'GET', cache: 'no-store', signal: AbortSignal.timeout(this.options.timeoutMs ?? 30_000),
        headers: { apikey: this.options.serviceKey, Authorization: `Bearer ${this.options.serviceKey}`, ...extra },
      });
      if (response.status === 404) throw new AppError('NOT_FOUND', { provider: 'db', reason: 'table_missing' });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        const code = body && typeof body === 'object' && 'code' in body ? String((body as { code: unknown }).code) : '';
        if (code === 'PGRST205' || code === '42P01') throw new AppError('NOT_FOUND', { provider: 'db', reason: 'table_missing' });
        throw new AppError(response.status === 429 ? 'RATE_LIMITED' : 'PROVIDER_UNAVAILABLE', { provider: 'db', httpStatus: response.status });
      }
      return response;
    } catch (error) {
      if (isAppError(error)) throw error;
      throw new AppError('PROVIDER_UNAVAILABLE', { provider: 'db', reason: 'network' });
    }
  }

  async page(request: BackupPageRequest): Promise<BackupRow[]> {
    if (!request.order.length || !request.order.every(c => COLUMN.test(c))) throw new AppError('VALIDATION_FAILED', { reason: 'backup_order' });
    if (request.select && !SELECT.test(request.select)) throw new AppError('VALIDATION_FAILED', { reason: 'backup_select' });
    const query = new URLSearchParams({
      select: request.select ?? '*',
      order: request.order.map(c => `${c}.${request.desc ? 'desc' : 'asc'}`).join(','),
      limit: String(Math.min(1000, Math.max(1, request.limit))),
    });
    if (request.after) query.set('or', keysetFilter(request.order, request.desc, request.after));
    const page: unknown = await (await this.get(request.table, query)).json();
    if (!Array.isArray(page) || page.some(row => row === null || typeof row !== 'object' || Array.isArray(row))) throw new AppError('SCHEMA_DRIFT', { provider: 'db', kind: 'response' });
    return page as BackupRow[];
  }

  async count(table: string): Promise<number | null> {
    const response = await this.get(table, new URLSearchParams({ select: '*', limit: '1' }), { Prefer: 'count=exact' });
    const total = response.headers.get('content-range')?.split('/')[1];
    return total && /^\d+$/.test(total) ? Number(total) : null;
  }
}
