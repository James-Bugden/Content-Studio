import { ownerRoute } from '@/replies/lib/server/owner-route';
import { jsonResponse, readJson } from '@/replies/lib/server/http';
import { getStore } from '@/replies/lib/server/get-store';
import { AppError } from '@/replies/lib/contracts/errors';
import { refineRequestSchema, type RefineResponse } from '@/replies/lib/contracts/api';
import { createGenerator } from '@/replies/lib/ai';
import { assembleRewriteInstruction, checkRewrite, parseRewriteOutput } from '@/replies/lib/ai/tasks';
import { needsEnglishMeaning } from '@/replies/lib/contracts/vocabulary';
import { GENERATION } from '@/replies/lib/contracts/limits';

export const dynamic = 'force-dynamic';

/**
 * POST /api/reply/refine (D08).
 *
 * This returns a proposal and nothing else. It does not update the session, and
 * the editor is not touched until the owner presses Apply rewrite, because a
 * rewrite that lands while they are mid-sentence destroys work they cannot recover.
 *
 * `base_editor_version` travels back with the proposal so the client can tell
 * whether it is still about the text on screen.
 *
 * A proposal sits one click from the editor, so it carries the authority of a
 * generated idea and is held to the same checks. This route used to return the
 * provider's raw text, which meant a rewrite could carry a link, a figure nobody
 * supplied, or a claim about the owner's career that no approved fact supports, and
 * one press of Apply rewrite would copy it in byte for byte. A rewrite that fails
 * the checks is not offered at all: the owner's own reply is already on screen and
 * is the safe thing to keep.
 */
export const POST = ownerRoute(async (request, { session }) => {
  const body = await readJson(request, refineRequestSchema);
  const store = getStore(session);

  const replySession = await store.getSession(body.session_id);
  if (!replySession) throw new AppError('not_found', 'That is not available.');
  if (replySession.editor_version !== body.expected_editor_version) {
    throw new AppError('version_conflict', 'Your reply changed. Try that again.');
  }
  if (replySession.draft_text.trim() === '') {
    throw new AppError('validation_failed', 'Write a reply first.');
  }

  const generator = createGenerator();
  if (!generator) {
    throw new AppError('not_configured', 'Rewrites are not set up yet. Your reply is unchanged.');
  }

  const context = await store.generationContext(body.session_id, []);
  const requireEnglishMeaning = needsEnglishMeaning(context.platform);
  // A rewrite is never asked to build on a cited past reply, so the seed list the
  // guards read is empty rather than carried over from a generation run.
  const guardContext = { ...context, seedReplyIds: [] };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GENERATION.attemptDeadlineMs);
  try {
    const attempt = await generator.complete(
      assembleRewriteInstruction(body.action, context.facts, { requireEnglishMeaning }),
      replySession.draft_text,
      { signal: controller.signal, maxOutputTokens: GENERATION.outputTokenBudget, task: 'rewrite' },
    );

    const parsed = parseRewriteOutput(attempt.rawText);
    if (!parsed.ok) {
      throw new AppError('provider_invalid_response', 'Could not rewrite that. Your reply is unchanged.');
    }

    const report = checkRewrite(parsed.value, body.action, guardContext, replySession.draft_text);
    if (report.hardFailures.length > 0) {
      // No repair attempt, deliberately. A rewrite costs nothing to skip, and a
      // second call to fix the first one is how a button the owner can press on
      // every draft turns into an unbounded bill.
      throw new AppError(
        'withheld_unsafe',
        'That rewrite did not pass the grounding checks, so it is not being offered. Your reply is unchanged.',
      );
    }

    const response: RefineResponse = {
      proposed_text: parsed.value.revised_text.trim(),
      base_editor_version: replySession.editor_version,
      english_meaning: parsed.value.english_meaning,
    };
    return jsonResponse(response);
  } finally {
    clearTimeout(timer);
  }
});

