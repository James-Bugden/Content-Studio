import { ownerRoute } from '@/replies/lib/server/owner-route';
import { getStore } from '@/replies/lib/server/get-store';
import { jsonResponse, readJson } from '@/replies/lib/server/http';
import { AppError } from '@/replies/lib/contracts/errors';
import { markPostedRequestSchema, progressSchema } from '@/replies/lib/contracts/api';
import { contentHash, payloadFingerprint, searchText } from '@/replies/lib/contracts/text';
import { publicConfig, serverConfig } from '@/replies/lib/config/env';

export const dynamic = 'force-dynamic';

/**
 * POST /api/reply/mark-posted (C07, C09, SAVE-01 to SAVE-03).
 *
 * The operation key comes from the client in an `Idempotency-Key` header and is a
 * stable UUID for one press of Mark posted, reused by every retry of that press.
 * The fingerprint is derived here from the submitted payload. Same key plus same
 * fingerprint replays the existing result; same key plus different text is a 409.
 *
 * Nothing in this route modifies `final_text`. It is not trimmed, normalised,
 * spell-checked or given a link: the whole point of the feature is that what gets
 * stored is what the owner posted. The normalised copy for search is computed
 * separately and stored in its own column.
 */
export const POST = ownerRoute(async (request, { session }) => {
  const operationKey = request.headers.get('idempotency-key');
  if (!operationKey || !/^[0-9a-f-]{36}$/i.test(operationKey)) {
    throw new AppError('validation_failed', 'That request was not valid.');
  }

  const body = await readJson(request, markPostedRequestSchema);

  const fingerprint = payloadFingerprint({
    session_id: body.session_id,
    editor_version: body.editor_version,
    final_text: body.final_text,
    reply_url: body.reply_url ?? null,
    posted_at: body.posted_at ?? null,
    resource_snapshots: body.resource_snapshots,
  });

  const embeddingModel =
    serverConfig().embedding.mode === 'live' ? serverConfig().embedding.model : 'unconfigured';

  const store = getStore(session);

  const result = await store.recordReply({
    operationKey,
    fingerprint,
    sessionId: body.session_id,
    editorVersion: body.editor_version,
    finalText: body.final_text,
    contentHash: contentHash(body.final_text),
    searchText: searchText(body.final_text),
    replyUrl: body.reply_url ?? null,
    postedAt: body.posted_at ?? null,
    resourceSnapshots: body.resource_snapshots,
    embeddingModel,
  });

  // A replayed response refreshes the current counts rather than reapplying an
  // optimistic increment, so two tabs cannot show 4/10 and 5/10 for one reply.
  const progress = progressSchema.parse(await store.dailyCounts(publicConfig().timezone));

  return jsonResponse({
    reply_id: result.replyId,
    replayed: result.replayed,
    recorded_at: result.recordedAt,
    progress,
    embedding_status: embeddingModel === 'unconfigured' ? 'unavailable' : 'queued',
  });
});

