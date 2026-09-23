import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { BetaMessage, MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { Capability } from '@/domain/capability';
import { AppError, type ErrorCode } from '@/domain/errors';
import type { AiGateway, AiResult, AiTask } from '@/application/ports';
import { AiCancelled, runTask, type ModelCaller, type ModelReply } from './pipeline';

/**
 * Anthropic adapter (CS-009). Official SDK, structured JSON output, adaptive
 * thinking, server-side refusal fallbacks, no tools. The model receives only the
 * task prompt and untrusted data; it never sees a secret (SEC-12).
 */
export const DEFAULT_AI_MODEL = 'claude-opus-5';

/** The one SDK surface this adapter uses, so tests can inject a fake. */
export type MessagesApi = {
  create(body: MessageCreateParamsNonStreaming, options?: { signal?: AbortSignal }): PromiseLike<BetaMessage>;
};

export function mapProviderError(error: unknown): ErrorCode | 'cancelled' {
  if (error instanceof Anthropic.APIUserAbortError) return 'cancelled';
  if (error instanceof Anthropic.RateLimitError) return 'RATE_LIMITED';
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) return 'CONFIG_MISSING';
  if (error instanceof Anthropic.APIConnectionError) return 'PROVIDER_UNAVAILABLE';
  if (error instanceof Anthropic.APIError && typeof error.status === 'number' && error.status >= 500) return 'PROVIDER_UNAVAILABLE';
  return 'UNKNOWN';
}

export class AnthropicAiGateway implements AiGateway {
  private readonly messages: MessagesApi;
  readonly model: string;

  constructor(options: { apiKey: string; model?: string; messages?: MessagesApi }) {
    this.model = options.model?.trim() || DEFAULT_AI_MODEL;
    this.messages = options.messages ?? new Anthropic({ apiKey: options.apiKey, timeout: 45_000, maxRetries: 1 }).beta.messages;
  }

  capability(): Capability {
    return { provider: 'ai', mode: 'live', state: 'ready' };
  }

  run<T, I>(task: AiTask<T, I>, input: I, opts: { signal?: AbortSignal } = {}): Promise<AiResult<T>> {
    const format = zodOutputFormat(task.schema);
    const call: ModelCaller = async (req, signal) => {
      let res: BetaMessage;
      try {
        res = await this.messages.create(
          {
            model: this.model,
            max_tokens: req.maxOutputTokens,
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
            thinking: { type: 'adaptive' },
            output_config: { effort: 'medium', format: { type: 'json_schema', schema: format.schema } },
            system: req.system,
            messages: req.messages,
          },
          signal ? { signal } : undefined,
        );
      } catch (error) {
        const mapped = mapProviderError(error);
        if (mapped === 'cancelled') throw new AiCancelled();
        throw new AppError(mapped, { provider: 'ai' });
      }
      const stop = res.stop_reason;
      const texts = stop === 'refusal' ? [] : res.content.flatMap((b) => (b.type === 'text' ? [b.text] : []));
      const reply: ModelReply = {
        stopReason: stop === 'end_turn' || stop === 'max_tokens' || stop === 'refusal' ? stop : 'other',
        text: texts.length ? texts.join('') : null,
        model: res.model,
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
      };
      return reply;
    };
    return runTask({ provider: 'anthropic', model: this.model }, task, input, call, opts);
  }
}
