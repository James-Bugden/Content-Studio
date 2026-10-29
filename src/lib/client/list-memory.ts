/**
 * Remembers where the owner was in a list (scroll position and last opened row) for
 * this tab, keyed by the page and its view params, so returning to the list lands
 * on the same row (#247). Tab-local; ids and numbers only, never copy.
 */
export type ListMemory = { scrollY: number; lastId: string | null };

const PANEL_KEYS = ['post', 'slot', 'queue'];

export function listMemoryKey(pathname: string, params: URLSearchParams): string {
  const entries = [...params.entries()].filter(([k]) => !PANEL_KEYS.includes(k)).sort(([a], [b]) => a.localeCompare(b));
  return `cs:list:${pathname}?${new URLSearchParams(entries).toString()}`;
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;

export function readListMemory(store: Store | null, key: string): ListMemory | null {
  try {
    const raw = store?.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<ListMemory>;
    const scrollY = typeof value.scrollY === 'number' && Number.isFinite(value.scrollY) && value.scrollY >= 0 ? value.scrollY : 0;
    const lastId = typeof value.lastId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value.lastId) ? value.lastId : null;
    return { scrollY, lastId };
  } catch { return null; }
}

export function writeListMemory(store: Store | null, key: string, memory: ListMemory): void {
  try { store?.setItem(key, JSON.stringify(memory)); } catch { /* storage unavailable: remembering is a convenience */ }
}

export function tabStorage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.sessionStorage; } catch { return null; }
}
