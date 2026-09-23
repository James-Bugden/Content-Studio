/**
 * Tab-local private recovery lives in sessionStorage under keys prefixed `cs:`.
 * Signing out clears every such key (SEC-09). Browser-only; safe to call when
 * storage is unavailable.
 */
export const LOCAL_RECOVERY_PREFIX = 'cs:';

export function clearLocalRecovery(storage: Storage | undefined = globalThis.sessionStorage): number {
  if (!storage) return 0;
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key !== null && key.startsWith(LOCAL_RECOVERY_PREFIX)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
    return keys.length;
  } catch {
    return 0;
  }
}
