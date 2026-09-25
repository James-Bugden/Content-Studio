import { ownerRoute } from '@/replies/lib/server/owner-route';
import { getStore } from '@/replies/lib/server/get-store';
import { jsonResponse, readJson } from '@/replies/lib/server/http';
import { sessionPatchRequestSchema } from '@/replies/lib/contracts/api';
import { contentHash } from '@/replies/lib/contracts/text';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/reply/session (C07, C10).
 *
 * The versioned server draft. `expected_editor_version` is what stops a second tab,
 * or a slow request that overtook a fast one, from writing older text over newer
 * text: a mismatch is a 409 and the caller keeps what it has.
 *
 * Saving a draft never touches the English meaning itself. It reports whether the
 * meaning has gone stale so the client can say so, because the Chinese is the
 * posting text and only the owner changes it.
 */
export const PATCH = ownerRoute(async (request, { session }) => {
  const body = await readJson(request, sessionPatchRequestSchema);
  const hash = contentHash(body.draft_text);

  const store = getStore(session);
  const result = await store.updateSessionDraft(
    body.session_id,
    body.expected_editor_version,
    body.draft_text,
    hash,
  );

  return jsonResponse({
    session_id: body.session_id,
    editor_version: result.editorVersion,
    draft_hash: hash,
    meaning_is_stale: result.meaningIsStale,
  });
});

