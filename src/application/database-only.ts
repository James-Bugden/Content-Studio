import 'server-only';
import type { ContentRepository } from './ports';
import { databaseBodyRepository } from './markdown-export';

/** Disposable display cache only. Point reads and the RPC's CAS always stay fresh.
 * Invalidate before AND after a write, fencing reads begun during an RPC too. */
export function databaseOnlyRepository(repo: ContentRepository, writable: boolean, ttlMs = 3_000): ContentRepository {
  const cache = new Map<PropertyKey, { until: number; pending: Promise<unknown> }>();
  const reads = new Set(['listLibrary', 'listQueue', 'listReadyQueue', 'listSchedule', 'queueSummary', 'workflowSettings', 'schema']);
  const writes = new Set(['updateLibrary', 'updateQueue', 'updateSchedule', 'createQueueIdea', 'updatePostProperties']);
  return databaseBodyRepository(new Proxy(repo, { get(target, key) {
    if (key === 'capability') return () => ({ ...target.capability(), state: writable ? 'ready' : 'read_only' });
    const method = Reflect.get(target, key);
    if (typeof method !== 'function') return method;
    if (writes.has(String(key))) return async (...args: unknown[]) => {
      if (!writable) return { ok: false, operationId: (args[0] as { operationId: string }).operationId, code: 'FORBIDDEN',
        steps: [{ step: 'write database', provider: 'db', status: 'failed', errorCode: 'FORBIDDEN' }] };
      cache.clear();
      try { return await method.apply(target, args); } finally { cache.clear(); }
    };
    if (reads.has(String(key))) return () => {
      const hit = cache.get(key);
      if (hit && hit.until > Date.now()) return hit.pending;
      const entry = { until: Date.now() + ttlMs, pending: Promise.resolve().then(() => method.call(target)) };
      cache.set(key, entry);
      entry.pending.catch(() => { if (cache.get(key) === entry) cache.delete(key); });
      return entry.pending;
    };
    return method.bind(target);
  } }));
}
