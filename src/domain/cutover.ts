import { z } from 'zod';

/** Public aggregate contract shared by the server projection and owner UI. */
export const CUTOVER_REASONS = ['invalid_gate', 'full_parity_required', 'parity_not_green',
  'backup_waiver_export_not_exact', 'write_proof_missing', 'write_proof_expired',
  'phase_c_proof_missing', 'rollback_proof_missing', 'backup_proof_missing', 'gate_unavailable'] as const;
export const cutoverReasonText: Record<typeof CUTOVER_REASONS[number], string> = {
  invalid_gate: 'The server could not check this switch. Ask the coordinator to check the deployment.',
  full_parity_required: 'Import and measure all collections first.',
  parity_not_green: 'The Sheet and database comparison is incomplete, different or too old. Import and measure again.',
  backup_waiver_export_not_exact: 'The backup waiver needs a fresh, exact Sheet export with no unresolved differences.',
  write_proof_missing: 'The database write checks have not been recorded.',
  write_proof_expired: 'The database write checks are too old. The coordinator must repeat them.',
  phase_c_proof_missing: 'The read and write rehearsal checks are incomplete.',
  rollback_proof_missing: 'An exact rollback rehearsal is missing or too old.',
  backup_proof_missing: 'A verified backup is missing or too old.',
  gate_unavailable: 'The server could not verify readiness. Refresh status or ask the coordinator to inspect.',
};
const age = z.number().int().nonnegative().nullable();
const gate = z.object({ ok: z.boolean(), reasons: z.array(z.enum(CUTOVER_REASONS)) })
  .refine(v => v.ok ? v.reasons.length === 0 : v.reasons.length > 0);
export const cutoverStatusSchema = z.object({
  build: z.string().regex(/^[a-f0-9]{40}$/), deploymentId: z.string().regex(/^dpl_[A-Za-z0-9]{1,128}$/).nullable(),
  store: z.enum(['sheet', 'db-shadow', 'db-read', 'db']), contract: z.literal('schema-2:cutover-1'),
  epoch: z.enum(['none', 'read', 'db', 'retired']), writesDisabled: z.boolean(),
  gates: z.object({ 'db-read': gate, db: gate }),
  evidenceAgesMs: z.object({ parity: age, 'phase-c': age, rehearsal: age, backup: age }),
  waivers: z.object({ calendar: z.object({ audited: z.boolean() }), backup: z.object({ audited: z.boolean() }) }),
  lastImportAgeMs: age,
  synthetic: z.boolean().optional(),
});
export type CutoverStatus = z.infer<typeof cutoverStatusSchema>;
export type SwitchAction = 'activate-read' | 'activate-db';
export type CutoverAction = 'measure' | 'backup' | 'rollback' | 'export' | SwitchAction;
export const CUTOVER_COLLECTIONS = ['library', 'queue', 'ready', 'schedule', 'queue_summary', 'workflow_settings'] as const;

/** Compare authority and both admission verdicts, not naturally increasing ages. */
export function sameCutoverDecision(a: CutoverStatus, b: CutoverStatus) {
  const decision = (s: CutoverStatus) => [s.build, s.deploymentId, s.contract, s.store, s.epoch, s.writesDisabled, s.gates, s.waivers];
  return JSON.stringify(decision(a)) === JSON.stringify(decision(b));
}

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const count = z.number().int().nonnegative();
const counts = z.object({ library: count, queue: count, schedule: count, workflow_settings: count });
const parity = z.object({ exact: z.literal(true), dbHash: hash, sheetHash: hash, counts, differences: z.array(z.unknown()).length(0) })
  .refine(v => v.dbHash === v.sheetHash);
/** Like the terminal runner, an HTTP 200 alone never completes a pending UUID. */
export function verifiedCutoverResult(action: CutoverAction, value: unknown, build: string) {
  if (action === 'activate-read' || action === 'activate-db') return z.object({
    mode: z.literal(action === 'activate-read' ? 'db-read' : 'db'), build: z.literal(build), contract: z.literal('schema-2:cutover-1'),
  }).safeParse(value).success;
  if (action === 'backup') return z.union([
    z.object({ status: z.enum(['verified', 'already_verified']), manifestHash: hash }),
    z.object({ status: z.literal('backup_waived'), waiver: z.object({ audited: z.literal(true), build: z.literal(build), auditHash: hash }) }),
  ]).safeParse(value).success;
  if (action === 'export') return parity.safeParse(value).success;
  if (action === 'rollback') return z.object({ readyToFlip: z.literal('sheet'), writesDisabled: z.literal(true),
    build: z.literal(build), parity }).safeParse(value).success;
  const sample = z.object({ collection: z.enum(CUTOVER_COLLECTIONS), idsEqual: z.literal(true), blocking: z.literal(0), fields: count, equal: count,
    lagMs: z.number().nonnegative().max(900_000) }).refine(v => v.equal <= v.fields && (v.fields === 0 || v.equal / v.fields >= .999));
  const measured = z.object({ coverage: z.literal('all-rows'), build: z.literal(build), samples: z.record(z.string(), sample) }).safeParse(value);
  return measured.success && ['library', 'queue', 'ready', 'schedule', 'queue_summary', 'workflow_settings']
    .every(k => measured.data.samples[k]?.collection === k);
}
