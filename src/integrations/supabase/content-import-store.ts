import 'server-only';
import { z } from 'zod';
import { assertImportMode, type ContentImportStore, type ImportEnvelope } from '@/application/content-import';
import type { ContentDb } from '@/application/content-db';
import { mirrorHash } from '@/application/sheet-mirror';
import { AppError, isAppError } from '@/domain/errors';
import { SupabaseContentDb, type SupabaseContentDbOptions } from './content-db';

/** Explicitly constructed only; production composition does not wire this writer. */
export class SupabaseContentImportStore implements ContentImportStore {
  readonly db: ContentDb;
  constructor(private readonly options: SupabaseContentDbOptions) { this.db = new SupabaseContentDb(options); }
  async applyImport(e: ImportEnvelope): Promise<void> {
    assertImportMode();
    if (e.snapshotHash !== mirrorHash({ counts: e.counts, hashes: e.hashes, exceptions: e.exceptions, rows: e.rows })) throw new AppError('VALIDATION_FAILED');
    try {
      const response = await (this.options.fetch ?? fetch)(`${this.options.url.replace(/\/$/, '')}/rest/v1/rpc/content_studio_import_run`, {
        method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
        headers: { apikey: this.options.serviceKey, Authorization: `Bearer ${this.options.serviceKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_operation_id: e.operationId, p_snapshot_hash: e.snapshotHash, p_actor_hash: e.actorHash,
          p_counts: e.counts, p_hashes: e.hashes, p_exceptions: e.exceptions, p_rows: e.rows }),
      });
      if (!response.ok) throw new AppError(response.status === 409 ? 'CONFLICT' : response.status === 429 ? 'RATE_LIMITED' : 'PROVIDER_UNAVAILABLE', { provider: 'db', httpStatus: response.status });
      const result = z.object({ ok: z.boolean(), code: z.string().nullable(), steps: z.array(z.object({ state: z.string() })), revision: z.union([z.number(), z.string()]).nullable() }).safeParse(await response.json());
      if (!result.success) throw new AppError('SCHEMA_DRIFT', { kind: 'import_result' });
      if (!result.data.ok) throw new AppError('CONFLICT', { provider: 'db' });
    } catch (error) {
      if (isAppError(error)) throw error;
      throw new AppError('PROVIDER_UNAVAILABLE', { provider: 'db', reason: 'network' });
    }
  }
}
