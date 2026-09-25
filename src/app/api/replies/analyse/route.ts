import { ownerRoute } from '@/replies/lib/server/owner-route';
import { jsonResponse, readJson } from '@/replies/lib/server/http';
import { getStore } from '@/replies/lib/server/get-store';
import { analyseRequestSchema, type AnalyseResponse } from '@/replies/lib/contracts/api';

export const dynamic = 'force-dynamic';

/**
 * POST /api/reply/analyse (C07, D04).
 *
 * Retrieval first, generation second, and they are separate requests on purpose.
 * The owner sees their own past writing and the resources they could share while
 * the model is still thinking, and a model outage cannot take those away because
 * they were never waiting on it.
 *
 * Keyword mode is retrieval only. It answers "what have I written about this",
 * and it never pretends there is a third-party post to reply to.
 */
export const POST = ownerRoute(async (request, { session }) => {
  const body = await readJson(request, analyseRequestSchema);
  const store = getStore(session);

  const result = await store.analyse({
    requestKey: body.request_key,
    platform: body.platform,
    targetKind: body.target_kind,
    sourceText: body.source_text,
    parentText: body.parent_text ?? null,
    sourceUrl: body.source_url ?? null,
  });

  const response: AnalyseResponse = {
    session_id: result.sessionId,
    source_post_id: result.sourcePostId,
    source_version: result.sourceVersion,
    context_version: result.contextVersion,
    editor_version: result.editorVersion,
    history: {
      state: result.history.state,
      items: result.history.items,
      next_cursor: result.history.nextCursor,
      reason: result.history.reason,
    },
    resources: {
      state: result.resources.state,
      items: result.resources.items,
      reason: result.resources.reason,
    },
    generation_expected: body.target_kind !== 'keyword',
  };

  return jsonResponse(response);
});

