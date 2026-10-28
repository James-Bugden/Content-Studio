import { ownerRoute } from '@/replies/lib/server/owner-route';
import { jsonResponse, readJson } from '@/replies/lib/server/http';
import { getStore } from '@/replies/lib/server/get-store';
import { AppError } from '@/replies/lib/contracts/errors';
import {
  suggestionsRequestSchema,
  suggestionsResponseSchema,
  type SuggestionsResponse,
} from '@/replies/lib/contracts/api';

export const dynamic = 'force-dynamic';

/**
 * POST /api/replies/suggestions (#245).
 *
 * Facts, earlier Content Library posts and images that fit the pasted post. This is
 * a search, not a generation: no model is called and nothing is billed, which is
 * why it can run on the same click that asks for ideas.
 *
 * The response is parsed through its own schema on the way out. That is the bound:
 * a handful of short texts and same-origin image URLs, never the library, and never
 * a path or link into the storage behind it.
 */
export const POST = ownerRoute(async (request, { session }) => {
  const body = await readJson(request, suggestionsRequestSchema);
  const store = getStore(session);

  const replySession = await store.getSession(body.session_id);
  if (!replySession) throw new AppError('not_found', 'That is not available.');

  const found = await store.suggestions({ sessionId: body.session_id, factIds: body.fact_ids ?? [] });
  const response: SuggestionsResponse = suggestionsResponseSchema.parse(found);
  return jsonResponse(response);
});
