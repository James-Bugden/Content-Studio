import type { EditorModel } from '@/domain/views';

/**
 * Editor load for the Backlog panel. CS-047 also prefetched the next post here;
 * CS-051 removed that because each editor load reads whole Sheet tabs, and the
 * extra read per post pushed production into Google's per-minute Sheets quota
 * ("The provider asked us to slow down").
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
