/** Phase C keeps authority display caches short in both fake and live compositions. */
export const DB_READ_CACHE_TTL_MS = 3_000;
export function contentSheetCacheOptions(store: 'sheet' | 'db-shadow' | 'db-read' | 'db', mode: 'fake' | 'live') {
  if (store === 'db-read') return { readCacheMs: DB_READ_CACHE_TTL_MS, libraryReadCacheMs: DB_READ_CACHE_TTL_MS, readinessReadCacheMs: DB_READ_CACHE_TTL_MS };
  return mode === 'live' ? { readCacheMs: 3_000, libraryReadCacheMs: 60_000, readinessReadCacheMs: 60_000 } : {};
}
