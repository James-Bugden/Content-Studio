import 'server-only';
import { z } from 'zod';
import { AppError, isAppError } from '@/domain/errors';
import { SupabaseContentDb, type SupabaseContentDbOptions } from './content-db';

/** Shared REST boundary; errors never include provider bodies or credentials. */
export class ContentShadowStore {
  constructor(private readonly options: SupabaseContentDbOptions) {
    // Reuse the established URL/key allowlist, including for RPC-only callers.
    new SupabaseContentDb(options);
  }
  async rpc(name: string, body: Record<string, unknown>): Promise<unknown> {
    return this.request(`rpc/content_studio_shadow_${name}`, { method: 'POST', body: JSON.stringify(body) });
  }
  async rows(params: Record<string, string>): Promise<unknown[]> {
    const rows: unknown[] = [];
    for (;;) {
      const page = await this.request(`content_studio_shadow_events?${new URLSearchParams({ select: '*', order: 'at.asc,event_id.asc', limit: '1000', ...params, offset: String(rows.length) })}`, { method: 'GET' });
      if (!Array.isArray(page)) throw new AppError('SCHEMA_DRIFT', { kind: 'shadow_events' });
      rows.push(...page);
      if (!page.length || params.limit === '1') return rows;
      // Continue even below 1000: hosted PostgREST may cap pages lower.
    }
  }
  private async request(path: string, init: RequestInit): Promise<unknown> {
    try {
      const response = await (this.options.fetch ?? fetch)(`${this.options.url.replace(/\/$/, '')}/rest/v1/${path}`, {
        ...init, cache: 'no-store', signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
        headers: { apikey: this.options.serviceKey, Authorization: `Bearer ${this.options.serviceKey}`, 'Content-Type': 'application/json' },
      });
      if (!response.ok) throw new AppError(response.status === 409 ? 'CONFLICT' : response.status === 401 || response.status === 403 ? 'FORBIDDEN'
        : response.status === 429 ? 'RATE_LIMITED' : 'PROVIDER_UNAVAILABLE', { provider: 'db', httpStatus: response.status });
      return await response.json();
    } catch (error) {
      if (isAppError(error)) throw error;
      throw new AppError('PROVIDER_UNAVAILABLE', { provider: 'db', reason: 'network' });
    }
  }
}

export const shadowClaimSchema = z.object({ status: z.enum(['acquired', 'in_progress', 'replayed']), result: z.unknown().optional() });
