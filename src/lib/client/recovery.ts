/**
 * Tab-local draft recovery (CS-008 SEC-11, UX-06).
 *
 * sessionStorage only: it dies with the tab, is never sent anywhere, and every key
 * starts with `cs:` so sign-out clears it (see local-recovery.ts). Keys are
 * namespaced by an opaque per-session value from the server so a different
 * account in the same tab never sees another session's text. Bounded in size and
 * count; no tokens or source archives are stored, only the draft being edited.
 */
export type RecoveryEntry = {
  libraryId: string;
  text: string;
  base: string;
  sheetRevision: string;
  sectionHash: string;
  savedAt: number;
};

const PREFIX = 'cs:draft:';
const MAX_CHARS = 40_000;
const MAX_ENTRIES = 20;

function key(ns: string, libraryId: string): string {
  return `${PREFIX}${ns}:${libraryId}`;
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function readRecovery(ns: string, libraryId: string): RecoveryEntry | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(key(ns, libraryId));
    if (!raw) return null;
    const v = JSON.parse(raw) as RecoveryEntry;
    return typeof v.text === 'string' && v.libraryId === libraryId ? v : null;
  } catch {
    return null;
  }
}

export function writeRecovery(ns: string, entry: RecoveryEntry): boolean {
  const s = storage();
  if (!s || entry.text.length > MAX_CHARS || entry.base.length > MAX_CHARS) return false;
  try {
    // Evict the oldest entries beyond the bound.
    const mine: { k: string; at: number }[] = [];
    for (let i = 0; i < s.length; i += 1) {
      const k = s.key(i);
      if (!k || !k.startsWith(PREFIX)) continue;
      try {
        mine.push({ k, at: (JSON.parse(s.getItem(k) ?? '{}') as { savedAt?: number }).savedAt ?? 0 });
      } catch {
        mine.push({ k, at: 0 });
      }
    }
    const target = key(ns, entry.libraryId);
    const others = mine.filter((m) => m.k !== target).sort((a, b) => a.at - b.at);
    while (others.length >= MAX_ENTRIES) s.removeItem(others.shift()!.k);
    s.setItem(target, JSON.stringify(entry));
    return true;
  } catch {
    return false;
  }
}

export function clearRecovery(ns: string, libraryId: string): void {
  try {
    storage()?.removeItem(key(ns, libraryId));
  } catch {
    // ignore
  }
}
