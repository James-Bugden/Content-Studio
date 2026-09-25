import { ProviderError, type GenerationAttempt, type ReplyGenerator } from '../types';

/**
 * The Anthropic adapter (C08).
 *
 * Written against the Messages HTTP API with `fetch` rather than the SDK, for one
 * reason: this file is the entire surface through which the owner's private writing
 * leaves the machine, and it is short enough to read in full.
 *
 * What it does not do is as important as what it does. No tool definitions are sent,
 * so the model has no capability to invoke. No system prompt is assembled here, so
 * there is one place (prompts/assemble.ts) where the instruction is built. No retry
 * loop lives here: retries are the orchestrator's single shared budget, and a second
 * loop hidden in the adapter would quietly double the cost of every failure.
 *
 * Model id and pricing must be verified against official provider material before
 * deployment (#12 acceptance). The default in `src/lib/config/env.ts` is a starting
 * point, not a verified selection.
 */

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

interface AnthropicContentBlock {
  type: string;
  text?: string;
}

interface AnthropicResponse {
  content?: AnthropicContentBlock[];
  usage?: { input_tokens?: number; output_tokens?: number };
  model?: string;
}

function retryAfterFrom(response: Response): number | undefined {
  const header = response.headers.get('retry-after');
  if (!header) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : undefined;
}

export function createAnthropicGenerator(config: {
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
}): ReplyGenerator {
  const doFetch = config.fetchImpl ?? fetch;

  return {
    name: 'anthropic',
    model: config.model,

    async complete(instruction, userContent, options): Promise<GenerationAttempt> {
      const started = Date.now();
      let response: Response;

      try {
        response = await doFetch(API_URL, {
          method: 'POST',
          signal: options.signal,
          headers: {
            'content-type': 'application/json',
            'x-api-key': config.apiKey,
            'anthropic-version': API_VERSION,
          },
          body: JSON.stringify({
            model: config.model,
            max_tokens: options.maxOutputTokens,
            system: instruction,
            messages: [{ role: 'user', content: userContent }],
          }),
        });
      } catch (error) {
        if ((error as Error).name === 'AbortError') {
          throw new ProviderError('timeout', 'The attempt deadline passed.');
        }
        throw new ProviderError('unavailable', 'The provider could not be reached.');
      }

      if (response.status === 429) {
        throw new ProviderError('rate_limited', 'The provider is rate limiting.', retryAfterFrom(response));
      }
      if (response.status >= 500) {
        throw new ProviderError('unavailable', 'The provider returned a server error.');
      }
      if (!response.ok) {
        // The body can quote the request, which contains the owner's writing, so it
        // is neither read nor logged. The status is enough to act on.
        throw new ProviderError('invalid_response', `The provider rejected the request (${response.status}).`);
      }

      let parsed: AnthropicResponse;
      try {
        parsed = (await response.json()) as AnthropicResponse;
      } catch {
        throw new ProviderError('invalid_response', 'The provider returned something that was not JSON.');
      }

      const text = (parsed.content ?? [])
        .filter((block) => block.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text as string)
        .join('');

      if (text.trim() === '') {
        throw new ProviderError('invalid_response', 'The provider returned no text.');
      }

      return {
        rawText: text,
        usage: {
          inputTokens: parsed.usage?.input_tokens ?? null,
          outputTokens: parsed.usage?.output_tokens ?? null,
          durationMs: Date.now() - started,
        },
        model: parsed.model ?? config.model,
        provider: 'anthropic',
      };
    },
  };
}

