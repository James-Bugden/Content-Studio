import type { EditorModel } from '@/domain/views';

/**
 * Editor load and one-ahead prefetch for working through the Backlog in bulk.
 *
 * CS-047 added the prefetch, CS-051 removed it while each editor load cost about
 * a dozen Sheets requests, and CS-053 restores it: a page read is now one
 * request (CS-052), the server keeps the Library and the master file's text
 * cached, so the next post's load is mostly a single Drive metadata check.
 * An entry is used at most once and expires quickly; it is a head start, never
 * an authority: every save still sends the Sheet revision and Markdown section
 * hash it loaded, so a post that changed meanwhile is caught as a conflict.
 */
export type EditorLoad = { model: EditorModel; canEdit: boolean; ns: string };

export async function fetchEditor(libraryId: string, signal?: AbortSignal): Promise<EditorLoad> {
  const response = await fetch(`/api/library/${encodeURIComponent(libraryId)}/editor`, { credentials: 'same-origin', cache: 'no-store', signal });
  const body = (await response.json()) as { ok?: boolean; model?: EditorModel; canEdit?: boolean; ns?: string; message?: string; code?: string };
  if (!response.ok || !body.ok || !body.model || typeof body.canEdit !== 'boolean' || !body.ns) {
    throw Object.assign(new Error(body.message || 'The post could not be loaded.'), { code: body.code });
  }
  return { model: body.model, canEdit: body.canEdit, ns: body.ns };
}

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; promise: Promise<EditorLoad> }>();

/** Starts loading a post's editor in the background. Failures are dropped; the real open retries. */
export function prefetchEditor(libraryId: string): void {
  const hit = cache.get(libraryId);
  if (hit && Date.now() - hit.at < TTL_MS) return;
  const promise = fetchEditor(libraryId);
  promise.catch(() => cache.delete(libraryId));
  cache.set(libraryId, { at: Date.now(), promise });
}

/** Takes a fresh prefetched load if there is one (removing it), otherwise null. */
export function takePrefetchedEditor(libraryId: string): Promise<EditorLoad> | null {
  const hit = cache.get(libraryId);
  cache.delete(libraryId);
  return hit && Date.now() - hit.at < TTL_MS ? hit.promise : null;
}
