import 'server-only';
import { z } from 'zod';
import type { ServerEnv } from '@/lib/env';
import { AppError } from '@/domain/errors';
import { ContentShadowStore } from '@/integrations/supabase/content-shadow-store';
import { CUTOVER_CONTRACT } from './cutover-contract';

export const CUTOVER_REASONS = ['invalid_gate', 'full_parity_required', 'parity_not_green',
  'backup_waiver_export_not_exact', 'write_proof_missing', 'write_proof_expired',
  'phase_c_proof_missing', 'rollback_proof_missing', 'backup_proof_missing', 'gate_unavailable'] as const;
const gate = z.object({ ok: z.boolean(), reasons: z.array(z.enum(CUTOVER_REASONS)) })
  .refine(v => v.ok ? v.reasons.length === 0 : v.reasons.length > 0);
const age = z.number().int().nonnegative().nullable();
const audited = z.object({ audited: z.boolean() });
const statusSchema = z.object({ epoch: z.enum(['none', 'read', 'db', 'retired']),
  gates: z.object({ 'db-read': gate, db: gate }),
  evidenceAgesMs: z.object({ parity: age, 'phase-c': age, rehearsal: age, backup: age }),
  waivers: z.object({ calendar: audited, backup: audited }),
});

/** Dedicated read boundary: never constructs provider services or claims jobs.
 * Zod projects fixed aggregate fields; unexpected RPC fields cannot escape. */
export async function readCutoverStatus(env: ServerEnv) {
  const build = env.VERCEL_GIT_COMMIT_SHA ?? env.CS_COMMIT_SHA ?? '';
  if (!/^[a-f0-9]{40}$/.test(build)) throw new AppError('CONFIG_MISSING', { reason: 'cutover_build_identity' });
  if (env.CS_DATA_MODE !== 'live') throw new AppError('CONFIG_MISSING');
  // The shared REST constructor validates both configuration values.
  const store = new ContentShadowStore({ url: env.SUPABASE_READ_MODEL_URL ?? '', serviceKey: env.SUPABASE_READ_MODEL_SERVICE_KEY ?? '' });
  const status = statusSchema.parse(await store.cutoverRpc('status', {
    p_build: build, p_backup_waiver: env.CS_CONTENT_BACKUP_FOLDER_ID ? null : env.CS_BACKUP_GATE_WAIVED ?? null,
    p_calendar_waiver: env.CS_PARITY_WINDOW_WAIVED ?? null,
  }));
  return { build, deploymentId: env.VERCEL_DEPLOYMENT_ID ?? null, store: env.CS_CONTENT_STORE,
    contract: CUTOVER_CONTRACT, writesDisabled: env.CS_CONTENT_WRITE_ENABLED === 'false'
      || env.CS_CONTENT_STORE === 'db' && env.CS_CONTENT_WRITE_ENABLED !== 'true', ...status };
}
