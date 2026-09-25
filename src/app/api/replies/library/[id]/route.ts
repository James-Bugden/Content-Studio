import type { NextRequest } from 'next/server';
import { ownerRoute } from '@/replies/lib/server/owner-route';
import { jsonResponse, readJson } from '@/replies/lib/server/http';
import { getStore } from '@/replies/lib/server/get-store';
import { AppError } from '@/replies/lib/contracts/errors';
import { libraryPatchRequestSchema } from '@/replies/lib/contracts/api';
import { contentHash, searchText } from '@/replies/lib/contracts/text';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/library/:id (D05, D11, D14, C07).
 *
 * Two distinct actions share a route because they share a shape: both act on one
 * already-recorded reply and both are things the owner does to *this app's own
 * record* of what happened, never to the reply sitting on the social platform.
 *
 * A correction appends a private revision rather than rewriting history silently:
 * `store.correctReply` takes the revision the form was shown and rejects a stale
 * one, so a second correction made from another tab cannot be overwritten without
 * the owner seeing that it happened. A withdrawal only flips this app's own flag;
 * `setReplyWithdrawn` never calls out to LinkedIn, X or Threads.
 *
 * `ownerRoute`'s wrapper does not thread Next's dynamic-segment params through to
 * the handler, so the id is read directly off the request's own path rather than
 * from a second argument that never arrives here.
 */

function idFromPath(request: NextRequest): string {
  const segments = request.nextUrl.pathname.split('/').filter(Boolean);
  const id = segments[segments.length - 1];
  if (!id) throw new AppError('validation_failed', 'That request was not valid.');
  return id;
}

export const PATCH = ownerRoute(async (request, { session }) => {
  const id = idFromPath(request);
  const body = await readJson(request, libraryPatchRequestSchema);
  const store = getStore(session);

  if (body.action === 'correct') {
    const result = await store.correctReply(
      id,
      body.expected_revision,
      body.final_text,
      contentHash(body.final_text),
      searchText(body.final_text),
      body.reason,
    );
    return jsonResponse({ ok: true, revision: result.revision });
  }

  await store.setReplyWithdrawn(id, body.withdrawn);
  return jsonResponse({ ok: true });
});

