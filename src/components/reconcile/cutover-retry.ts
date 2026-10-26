import { z } from 'zod';

const pendingSchema = z.object({ key: z.string().uuid(), build: z.string().regex(/^[a-f0-9]{40}$/).nullable() }).strict();
export const cutoverRetrySlot = (action: string) => `content-studio.cutover.v1.${action}`;

/** sessionStorage is scoped to this origin/tab. Save before POST, keep on every
 * unconfirmed result, and never replace an activation UUID from another build. */
export function pendingCutover(action: string, build: string | null) {
  const slot = cutoverRetrySlot(action), raw = sessionStorage.getItem(slot);
  const pending = raw === null ? { key: crypto.randomUUID(), build } : pendingSchema.parse(JSON.parse(raw));
  if (pending.build !== build) throw new Error('pending_build');
  sessionStorage.setItem(slot, JSON.stringify(pending));
  return pending;
}

export function completeCutover(action: string) {
  sessionStorage.removeItem(cutoverRetrySlot(action));
}
