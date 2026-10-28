import 'server-only';
import { AppError } from '@/replies/lib/contracts/errors';

/**
 * One AI call per owner action, however many times the request arrives (#245).
 *
 * A double click, a retry after a lost response and a second tab all send the same
 * request key. Without this each would be a separate, billed model call. The first
 * call's promise is kept, so a duplicate shares it while it is running and gets its
 * answer afterwards. A failed call is forgotten at once, so a retry actually retries.
 *
 * It is per server process and bounded. It is a cost guard, not a ledger: durable
 * idempotency is the store's job, and the monthly cap is the hard stop.
 */

const KEY = Symbol.for('social-replies.ai-memo');
const MAX_ENTRIES = 100;
const KEEP_MS = 10 * 60 * 1000;

interface Entry {
  hash: string;
  at: number;
  run: Promise<unknown>;
}

type Holder = typeof globalThis & { [KEY]?: Map<string, Entry> };

function memo(): Map<string, Entry> {
  const scope = globalThis as Holder;
  scope[KEY] ??= new Map();
  return scope[KEY];
}

export async function once<T>(key: string, hash: string, run: () => Promise<T>): Promise<T> {
  const entries = memo();
  const now = Date.now();
  for (const [name, entry] of entries) if (now - entry.at > KEEP_MS) entries.delete(name);

  const existing = entries.get(key);
  if (existing) {
    if (existing.hash !== hash) {
      throw new AppError('idempotency_conflict', 'This request was already handled with different details.');
    }
    return existing.run as Promise<T>;
  }

  const promise = run();
  entries.set(key, { hash, at: now, run: promise });
  if (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value!);
  try {
    return await promise;
  } catch (error) {
    if (entries.get(key)?.run === promise) entries.delete(key);
    throw error;
  }
}

/** Test seam. */
export function resetAiMemo(): void {
  memo().clear();
}
