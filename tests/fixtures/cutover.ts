import type { CutoverStatus } from '../../src/domain/cutover';

export const cutoverBuild = 'a'.repeat(40);
export function cutoverStatus(): CutoverStatus {
  return { build: cutoverBuild, deploymentId: 'dpl_synthetic123', store: 'db-read', contract: 'schema-2:cutover-1', epoch: 'none',
    writesDisabled: true, gates: { 'db-read': { ok: true, reasons: [] }, db: { ok: true, reasons: [] } },
    evidenceAgesMs: { parity: 1000, 'phase-c': 2000, rehearsal: 3000, backup: null },
    waivers: { calendar: { audited: true }, backup: { audited: true } }, lastImportAgeMs: 1000 };
}
