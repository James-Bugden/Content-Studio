import { ownerRoute } from '@/replies/lib/server/owner-route';
import { jsonResponse, readJson } from '@/replies/lib/server/http';
import { getStore } from '@/replies/lib/server/get-store';
import { AppError } from '@/replies/lib/contracts/errors';
import { refineRequestSchema, type RefineResponse } from '@/replies/lib/contracts/api';
import { createGenerator } from '@/replies/lib/ai';
import {
  assembleRewriteInstruction,
  assembleRewriteUserContent,
  checkRewrite,
  parseRewriteOutput,
} from '@/replies/lib/ai/tasks';
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
 *
 * Sources (#245). A rewrite may be asked to lean on more facts, to draw on earlier
 * Content Library posts, or to stop relying on some facts. The browser sends ids
 * and nothing else. Every fact and post is read back from the owner's own rows
 * here, so there is no path by which text the browser typed becomes a "fact" or an
 * "earlier post" in the prompt. A fact must still be approved, active and in date.
 * An earlier post is reference material and, being the owner's own words, also
 * widens what counts as the owner's own evidence for the grounding checks; it can
 * never make an unapproved fact eligible.
 */
export const POST = ownerRoute(async (request, { session }) => {
  const body = await readJson(request, refineRequestSchema);
  const store = getStore(session);

  const replySession = await store.getSession(body.session_id);
  if (!replySession) throw new AppError('not_found', 'That is not available.');
  if (replySession.editor_version !== body.expected_editor_version) {
    throw new AppError('version_conflict', 'Your reply changed. Try that again.');
  }

  // A saved idea of THIS session may be rewritten in place of the draft.
  let baseText = replySession.draft_text;
  if (body.idea_id) {
    const idea = await store.getSuggestion(body.session_id, body.idea_id);
    if (!idea) throw new AppError('not_found', 'That is not available.');
    baseText = idea.reply_text;
  }
  if (baseText.trim() === '') {
    throw new AppError('validation_failed', 'Write a reply first.');
  }

  const extraFactIds = body.extra_fact_ids ?? [];
  const extraPostIds = body.extra_post_ids ?? [];
  const excludedFactIds = body.excluded_fact_ids ?? [];
  const asksForSources = extraFactIds.length + extraPostIds.length + excludedFactIds.length > 0;
  if (body.action === 'use_sources' && !asksForSources) {
    throw new AppError('validation_failed', 'Pick a source first.');
  }

  const extras = asksForSources
    ? await store.contextExtras({ factIds: extraFactIds, excludedFactIds, postIds: extraPostIds })
    : { facts: [], excluded: [], posts: [] };
  if (
    body.action === 'use_sources' &&
    extras.facts.length + extras.posts.length + extras.excluded.length === 0
  ) {
    // Every id named something that is not usable (unapproved, switched off, out of
    // date, deleted). Spending a model call on it would only rewrite nothing.
    throw new AppError('validation_failed', 'Those sources are not available.');
  }

  const generator = createGenerator();
  if (!generator) {
    throw new AppError('not_configured', 'Rewrites are not set up yet. Your reply is unchanged.');
  }

  const context = await store.generationContext(body.session_id, []);
  const requireEnglishMeaning = needsEnglishMeaning(context.platform);

  const excludedIds = new Set(extras.excluded.map((fact) => fact.id));
  const facts = [
    ...context.facts.filter((fact) => !excludedIds.has(fact.id) && !extras.facts.some((extra) => extra.id === fact.id)),
    ...extras.facts.filter((fact) => !excludedIds.has(fact.id)),
  ];
  const postsText = extras.posts.map((post) => post.text).join('\n');

  // A rewrite is never asked to build on a cited past reply, so the seed list the
  // guards read is empty rather than carried over from a generation run.
  const guardContext = { ...context, facts, seedReplyIds: [] };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GENERATION.attemptDeadlineMs);
  try {
    const attempt = await generator.complete(
      assembleRewriteInstruction(body.action, facts, {
        requireEnglishMeaning,
        excluded: extras.excluded,
        hasReferencePosts: extras.posts.length > 0,
      }),
      assembleRewriteUserContent(baseText, extras.posts),
      { signal: controller.signal, maxOutputTokens: GENERATION.outputTokenBudget, task: 'rewrite' },
    );

    const parsed = parseRewriteOutput(attempt.rawText);
    if (!parsed.ok) {
      throw new AppError('provider_invalid_response', 'Could not rewrite that. Your reply is unchanged.');
    }

    const report = checkRewrite(
      parsed.value,
      body.action,
      guardContext,
      postsText ? `${baseText}\n${postsText}` : baseText,
    );
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
