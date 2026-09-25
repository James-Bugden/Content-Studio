import { GENERATION } from '@/replies/lib/contracts/limits';
import { AppError, type ErrorCode } from '@/replies/lib/contracts/errors';
import { assemblePrompt } from './prompts/assemble';
import { parseProviderOutput, runGuards } from './guards';
import { ProviderError, type GenerationContext, type ProviderIdea, type ReplyGenerator } from './types';

/**
 * The generation orchestrator (C08, tests AI-01 and AI-02).
 *
 * Its whole job is to spend a bounded amount of time and money and then stop,
 * leaving the owner's draft untouched whatever happens.
 *
 * The budget is shared, which is the point. There is one repair attempt for the
 * whole request, not one per guard and not one per provider call, because the
 * failure mode this avoids is a bad response quietly costing three times as much as
 * a good one. A total budget sits above the per-attempt deadline so that a slow
 * first attempt cannot leave a second one running past the request's own lifetime.
 */

export interface GenerateOutcome {
  status: 'ok' | 'withheld' | 'failed';
  ideas: ProviderIdea[];
  warnings: string[];
  promptVersion: string;
  provider: string;
  model: string;
  usage: { inputTokens: number | null; outputTokens: number | null; durationMs: number };
  /** Number of provider calls actually made. Includes the repair attempt. */
  attempts: number;
  /** Present when status is not 'ok'. */
  failure?: {
    code: GenerateFailureCode;
    detail: string;
    retryAfterSeconds?: number;
  };
}

export type GenerateFailureCode =
  | 'provider_timeout'
  | 'provider_unavailable'
  | 'rate_limited'
  | 'provider_invalid_response'
  | 'withheld_unsafe';

/**
 * The reason the outcome gives, as the code the client is allowed to receive.
 *
 * Guards rejecting a response is not a provider fault, and reporting it as one put
 * a 502 blaming the vendor in front of a decision this app made on purpose. The
 * mapping lives here, next to the outcome it translates, so a route cannot quietly
 * flatten two different problems into one again.
 */
export function errorCodeForOutcome(code: GenerateFailureCode | undefined): ErrorCode {
  switch (code) {
    case 'rate_limited':
      return 'rate_limited';
    case 'provider_timeout':
      return 'provider_timeout';
    case 'provider_invalid_response':
      return 'provider_invalid_response';
    case 'withheld_unsafe':
      return 'withheld_unsafe';
    default:
      return 'provider_unavailable';
  }
}

export interface GenerateDependencies {
  generator: ReplyGenerator;
  /**
   * Durable per-owner rate limiting. Counting rows the database already writes is
   * the only version of this that survives more than one server instance, so the
   * caller supplies the count rather than this module keeping one in memory.
   */
  countRunsInLastHour?: () => Promise<number>;
  now?: () => number;
  nonce?: string;
  env?: Readonly<Record<string, string | undefined>>;
}

function failureCodeFor(kind: ProviderError['kind']): GenerateFailureCode {
  switch (kind) {
    case 'timeout':
      return 'provider_timeout';
    case 'rate_limited':
      return 'rate_limited';
    case 'invalid_response':
      return 'provider_invalid_response';
    default:
      return 'provider_unavailable';
  }
}

export async function generateIdeas(
  context: GenerationContext,
  deps: GenerateDependencies,
): Promise<GenerateOutcome> {
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const { instruction, userContent, promptVersion } = assemblePrompt(context, {
    ...(deps.nonce ? { nonce: deps.nonce } : {}),
    ...(deps.env ? { env: deps.env } : {}),
  });

  if (deps.countRunsInLastHour) {
    const used = await deps.countRunsInLastHour();
    if (used >= GENERATION.requestsPerOwnerPerHour) {
      throw new AppError('rate_limited', 'Reply ideas are temporarily paused. Your draft is unchanged.', {
        retryAfterSeconds: 300,
      });
    }
  }

  let attempts = 0;
  let lastWarnings: string[] = [];
  let repairHint: string | null = null;
  // Why the last attempt was rejected, so the outcome can say the true reason.
  // Reporting "did not pass the grounding checks" after a JSON parse failure
  // would send whoever reads it looking at the wrong thing.
  let lastRejection: 'unreadable' | 'unsafe' | null = null;
  let usage: GenerateOutcome['usage'] = { inputTokens: null, outputTokens: null, durationMs: 0 };

  const base = {
    promptVersion,
    provider: deps.generator.name,
    model: deps.generator.model,
  };

  // The first attempt plus at most one repair. Nothing else adds a call.
  for (let round = 0; round <= GENERATION.maxRepairAttempts; round += 1) {
    const elapsed = now() - startedAt;
    const remaining = GENERATION.totalRequestBudgetMs - elapsed;
    if (remaining <= 0) {
      return {
        ...base,
        status: 'failed',
        ideas: [],
        warnings: lastWarnings,
        usage,
        attempts,
        failure: { code: 'provider_timeout', detail: 'The request budget ran out.' },
      };
    }

    const controller = new AbortController();
    const deadline = Math.min(GENERATION.attemptDeadlineMs, remaining);
    const timer = setTimeout(() => controller.abort(), deadline);

    attempts += 1;
    let attemptResult;
    try {
      attemptResult = await deps.generator.complete(
        repairHint ? `${instruction}\n\n# Correction\n${repairHint}` : instruction,
        userContent,
        { signal: controller.signal, maxOutputTokens: GENERATION.outputTokenBudget, task: 'ideas' },
      );
    } catch (error) {
      clearTimeout(timer);
      if (!(error instanceof ProviderError)) {
        return {
          ...base,
          status: 'failed',
          ideas: [],
          warnings: lastWarnings,
          usage,
          attempts,
          failure: { code: 'provider_unavailable', detail: 'The provider could not be reached.' },
        };
      }

      // Honour a Retry-After only when waiting would still leave time to try. An
      // unapproved provider is never substituted: an outage keeps the manual path.
      const retryAfter = error.retryAfterSeconds;
      const canWait =
        error.kind === 'rate_limited' &&
        retryAfter !== undefined &&
        round < GENERATION.maxRepairAttempts &&
        now() - startedAt + retryAfter * 1000 + GENERATION.attemptDeadlineMs <=
          GENERATION.totalRequestBudgetMs;

      if (canWait) {
        await new Promise((resolve) => setTimeout(resolve, retryAfter! * 1000));
        continue;
      }

      return {
        ...base,
        status: 'failed',
        ideas: [],
        warnings: lastWarnings,
        usage,
        attempts,
        failure: {
          code: failureCodeFor(error.kind),
          detail: error.message,
          ...(retryAfter !== undefined ? { retryAfterSeconds: retryAfter } : {}),
        },
      };
    }
    clearTimeout(timer);

    usage = attemptResult.usage;

    const parsed = parseProviderOutput(attemptResult.rawText);
    if (!parsed.ok) {
      lastRejection = 'unreadable';
      repairHint = `The previous response could not be read: ${parsed.detail}. Return JSON only.`;
      continue;
    }

    const report = runGuards(parsed.value.ideas, context);
    lastWarnings = report.warnings;

    if (report.hardFailures.length === 0) {
      return {
        ...base,
        status: 'ok',
        ideas: parsed.value.ideas,
        warnings: report.warnings,
        usage,
        attempts,
      };
    }

    lastRejection = 'unsafe';
    repairHint = report.repairHint;
  }

  // The repair budget is spent. Either the response could not be read at all, or
  // it could be read and was not safe to show. Showing an unsafe one anyway would
  // be the single failure the owner cannot catch by reading, so both outcomes
  // withhold the ideas and leave retrieval and the manual editor carrying the work.
  return {
    ...base,
    status: 'withheld',
    ideas: [],
    warnings: lastWarnings,
    usage,
    attempts,
    failure:
      lastRejection === 'unreadable'
        ? {
            code: 'provider_invalid_response',
            detail: 'The provider did not return a readable response.',
          }
        : {
            code: 'withheld_unsafe',
            detail: 'The suggestions did not pass the grounding checks and were not shown.',
          },
  };
}

