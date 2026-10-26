import 'server-only';
import { z } from 'zod';
import type { CutoverAction } from '@/domain/cutover';
import { CUTOVER_COLLECTIONS } from '@/domain/cutover';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const count = z.number().int().nonnegative();
const parity = z.object({ exact: z.boolean(), dbHash: hash, sheetHash: hash,
  counts: z.object({ library: count, queue: count, schedule: count, workflow_settings: count }),
  // Export failures can contain private row identities/field names internally.
  // Keep the verdict without returning any of those diagnostic bytes.
  differences: z.array(z.unknown()).transform(v => v.length ? [{ reason: 'export_mismatch' }] : []),
});

/** Owner responses contain only reviewed aggregate facts. The cron/runner
 * response stays byte-for-byte compatible with its original contract. */
export function ownerCutoverResult(action: CutoverAction, value: unknown, build: string) {
  if (action === 'activate-read' || action === 'activate-db') return z.object({ mode: z.literal(action === 'activate-read' ? 'db-read' : 'db'),
    build: z.literal(build), contract: z.literal('schema-2:cutover-1') }).parse(value);
  if (action === 'export') return parity.parse(value);
  if (action === 'rollback') return z.object({ readyToFlip: z.literal('sheet'), writesDisabled: z.literal(true), build: z.literal(build), parity }).parse(value);
  if (action === 'backup') return z.union([
    z.object({ status: z.enum(['verified', 'already_verified']), manifestHash: hash }),
    z.object({ status: z.literal('backup_waived'), waiver: z.object({ audited: z.literal(true), build: z.literal(build), auditHash: hash }) }),
  ]).parse(value);
  const sample = z.object({ collection: z.enum(CUTOVER_COLLECTIONS), idsEqual: z.boolean(), blocking: count, fields: count, equal: count, lagMs: count.nullable() });
  return z.object({ coverage: z.literal('all-rows'), build: z.literal(build), samples: z.object({ library: sample, queue: sample,
    ready: sample, schedule: sample, queue_summary: sample, workflow_settings: sample }) }).parse(value);
}
