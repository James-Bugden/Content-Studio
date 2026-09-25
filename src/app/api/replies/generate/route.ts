import { ownerRoute } from '@/replies/lib/server/owner-route';
import { jsonResponse, readJson } from '@/replies/lib/server/http';
import { getStore } from '@/replies/lib/server/get-store';
import { AppError } from '@/replies/lib/contracts/errors';
import { generateRequestSchema, type GenerateResponse } from '@/replies/lib/contracts/api';
import { createGenerator } from '@/replies/lib/ai';
import { errorCodeForOutcome, generateIdeas } from '@/replies/lib/ai/generator';
import { assemblePrompt } from '@/replies/lib/ai/prompts/assemble';

export const dynamic = 'force-dynamic';

/**
 * POST /api/reply/generate (C07, C08, AI-01, AI-02).
 *
 * Three ideas, or an honest failure. Never two, never a placeholder, and never a
 * response the guards rejected.
 *
 * Stale context is a 409 rather than a silently-wasted provider call: if the owner
 * has changed the source since this request was composed, the ideas would be about
 * a post that is no longer on screen.
 */
export const POST = ownerRoute(async (request, { session }) => {
  const body = await readJson(request, generateRequestSchema);
  const store = getStore(session);

  const replySession = await store.getSession(body.session_id);
  if (!replySession) throw new AppError('not_found', 'That is not available.');
  if (replySession.source_version !== body.source_version) {
    throw new AppError('version_conflict', 'The post changed. Get reply ideas again.');
  }

  const generator = createGenerator();
  if (!generator) {
    // No provider is a supported state. Everything else on the screen still works,
    // so this is a 503 with a clear message rather than a fabricated success.
    throw new AppError('not_configured', 'Reply ideas are not set up yet. Everything else still works.');
  }

  const context = await store.generationContext(body.session_id, body.seed_reply_ids ?? []);
  const { promptVersion } = assemblePrompt({ ...context, seedReplyIds: body.seed_reply_ids ?? [] });

  const runId = await store.createGenerationRun({
    sessionId: body.session_id,
    sourceVersion: body.source_version,
    editorBaseVersion: replySession.editor_version,
    requestKey: body.request_key,
    contextVersion: body.context_version,
    promptVersion,
    provider: generator.name,
    model: generator.model,
  });

  const outcome = await generateIdeas(
    { ...context, seedReplyIds: body.seed_reply_ids ?? [] },
    { generator, countRunsInLastHour: () => store.countGenerationRunsInLastHour() },
  );

  await store.completeGenerationRun(runId, {
    status:
      outcome.status === 'ok'
        ? 'succeeded'
        : outcome.status === 'withheld'
          ? 'withheld'
          : (outcome.failure?.code ?? 'provider_error'),
    inputTokens: outcome.usage.inputTokens,
    outputTokens: outcome.usage.outputTokens,
    durationMs: outcome.usage.durationMs,
    errorCode: outcome.failure?.code ?? null,
  });

  if (outcome.status !== 'ok') {
    // The generator's reason is carried through rather than flattened. "Could not
    // be read" and "was read and was not safe" are different problems, and a reader
    // of a request log should be able to tell them apart. The second one is also
    // not the provider's fault, so it does not go out under a message blaming it.
    const code = errorCodeForOutcome(outcome.failure?.code);
    const message =
      code === 'withheld_unsafe'
        ? 'Those suggestions did not pass the grounding checks, so they are not shown. Your draft is unchanged.'
        : 'Could not create reply ideas. Your draft is unchanged.';
    throw new AppError(code, message, {
      ...(outcome.failure?.retryAfterSeconds
        ? { retryAfterSeconds: outcome.failure.retryAfterSeconds }
        : {}),
    });
  }

  const saved = await store.saveSuggestions(
    runId,
    outcome.ideas.map((idea) => ({
      position: idea.position,
      angle_label: idea.angle_label,
      reply_text: idea.reply_text,
      english_meaning: idea.english_meaning,
      resource_id: idea.resource_id,
      cta_text: idea.cta_text,
      uses_fact_ids: idea.uses_fact_ids,
      based_on_reply_ids: idea.based_on_reply_ids,
    })),
  );

  const response: GenerateResponse = {
    generation_run_id: runId,
    ideas: saved as GenerateResponse['ideas'],
    // A subtle marker, not a ranking. All three stay equally readable (D07).
    suggested_index: 0,
    allowed_refinements: ['shorter', 'more_direct', 'warmer'],
    repetition_warning: outcome.warnings[0] ?? null,
  };

  return jsonResponse(response);
});

