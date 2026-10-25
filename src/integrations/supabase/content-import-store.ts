import 'server-only';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { ContentShadowStore, shadowClaimSchema } from './content-shadow-store';
import { assertImportMode, type ContentImportStore, type ImportEnvelope } from '@/application/content-import';
import type { ContentDb } from '@/application/content-db';
import { mirrorHash } from '@/application/sheet-mirror';
import { AppError, isAppError } from '@/domain/errors';
import { SupabaseContentDb, type SupabaseContentDbOptions } from './content-db';

/** Phase A writer; live imports require a DB-issued, transaction-fenced lease. */
export class SupabaseContentImportStore implements ContentImportStore {
  readonly db: ContentDb;
  constructor(private readonly options: SupabaseContentDbOptions) { this.db = new SupabaseContentDb({ ...options, readOnly: true }); }
  async claim(operationId: string, requestHash: string) {
    assertImportMode();
    const token = randomUUID();
    const result = shadowClaimSchema.parse(await new ContentShadowStore(this.options).rpc('claim', { p_operation_id: operationId, p_request_hash: requestHash, p_token: token }));
    if (result.status === 'replayed') {
      const hash = z.string().regex(/^[a-f0-9]{64}$/);
      const collections = z.object({ library: z.number().int().nonnegative(), queue: z.number().int().nonnegative(), schedule: z.number().int().nonnegative(), workflow_settings: z.number().int().nonnegative() });
      result.result = z.object({ snapshotHash: hash, counts: collections, hashes: z.object({ library: hash, queue: hash, schedule: hash, workflow_settings: hash }),
        fullParity: z.object({ rows: z.number().int().nonnegative(), idsEqual: z.boolean(), fields: z.number().int().nonnegative(), equal: z.number().int().nonnegative(), unclassified: z.number().int().nonnegative() }).refine(p => p.equal <= p.fields).optional(),
        windowWaiver: z.object({ by: z.literal('owner'), on: z.literal('2026-10-25'), recordedAt: z.string().datetime({ offset: true }) }).nullable().optional(),
        exceptions: z.array(z.object({ class: z.enum(['formula_display', 'number_formatting', 'trailing_whitespace', 'blank_boolean', 'boolean_formatting', 'timestamp_formatting', 'refused_numeric', 'refused_size']), collection: z.enum(['library', 'queue', 'schedule', 'workflow_settings']), field: z.string(), hash })) }).parse(result.result);
    }
    return { ...result, token };
  }
  async release(operationId: string, token: string) {
    await new ContentShadowStore(this.options).rpc('release', { p_operation_id: operationId, p_token: token });
  }
  async applyImport(e: ImportEnvelope, leaseToken?: string): Promise<void> {
    assertImportMode();
    if (e.snapshotHash !== mirrorHash({ counts: e.counts, hashes: e.hashes, exceptions: e.exceptions, rows: e.rows })) throw new AppError('VALIDATION_FAILED');
    if (process.env.CS_DATA_MODE === 'live' && !leaseToken) throw new AppError('FORBIDDEN', { reason: 'import_lease_required' });
    if (leaseToken) {
      const result = await new ContentShadowStore(this.options).rpc('import', { p_operation_id: e.operationId, p_token: leaseToken,
        p_window_waiver: process.env.CS_PARITY_WINDOW_WAIVED ?? null,
        p_snapshot_hash: e.snapshotHash, p_actor_hash: e.actorHash, p_counts: e.counts, p_hashes: e.hashes, p_exceptions: e.exceptions, p_rows: e.rows });
      if (!z.object({ ok: z.literal(true) }).safeParse(result).success) throw new AppError('CONFLICT', { provider: 'db' });
      return;
    }
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
