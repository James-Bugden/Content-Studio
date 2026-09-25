import 'server-only';
import type { OwnerSession } from '@/replies/lib/auth/owner';
import type { Store } from './store';
import { createMemoryStore } from './memory-store';
import { createSupabaseStore } from './supabase-store';
import { isTestMode } from './test-mode';

export { isTestMode } from './test-mode';

/**
 * Selects the data layer.
 *
 * The in-memory double is reachable only for fake-data e2e runs outside
 * production. Everywhere else this returns the server-only Supabase store. The
 * service credential bypasses RLS by design, so the store explicitly scopes each
 * query to the owner resolved by the service-only database bridge.
 *
 * The test double is also a module-level singleton, deliberately: a browser journey
 * spans several requests and has to see its own writes.
 */

/**
 * The double is held on `globalThis`, not in a module variable.
 *
 * Next.js bundles server components and route handlers separately, so a
 * module-level singleton gives the page and the API *different* stores: the page
 * renders a count of 0 while the API already recorded a reply. A browser journey
 * then fails for a reason that has nothing to do with the product. One global
 * keeps the whole request path looking at one set of rows.
 */
const MEMORY_STORE_KEY = Symbol.for('social-replies.memory-store');

type GlobalWithStore = typeof globalThis & { [MEMORY_STORE_KEY]?: Store };

export function getStore(session: OwnerSession): Store {
  if (isTestMode()) {
    const scope = globalThis as GlobalWithStore;
    scope[MEMORY_STORE_KEY] ??= createMemoryStore();
    return scope[MEMORY_STORE_KEY];
  }
  return createSupabaseStore(session);
}

/** Test seam. Lets a journey start from a known state. */
export function resetMemoryStore(): void {
  delete (globalThis as GlobalWithStore)[MEMORY_STORE_KEY];
}
