import { EMBEDDING } from '@/replies/lib/contracts/limits';
import type { ErrorCode } from '@/replies/lib/contracts/errors';
import type { ProviderMode, ServerConfig } from '@/replies/lib/config/env';

/**
 * The embedding provider boundary (C05, C10).
 *
 * Three implementations, one of which is "there is no provider". That case is a
 * supported state rather than an error: the app must run with no keys at all,
 * lexical search works without a single vector, and a worker that treated a
 * missing provider as a failure would burn a job's five attempts and mark it
 * dead for the crime of being correctly configured for local development.
 *
 * Nothing here logs the text being embedded. The owner's writing is the private
 * asset this whole application exists to protect, and a provider log line is
 * exactly the kind of place it leaks from (C10).
 */

export interface EmbedOk {
  status: 'ok';
  model: string;
  /** One vector per input, in input order. */
  vectors: number[][];
}

export interface EmbedNotConfigured {
  status: 'not_configured';
  model: string;
}

export interface EmbedFailed {
  status: 'failed';
  model: string;
  code: ErrorCode;
  retryable: boolean;
}

export type EmbedResult = EmbedOk | EmbedNotConfigured | EmbedFailed;

export interface Embedder {
  readonly mode: ProviderMode;
  readonly model: string;
  embed(texts: readonly string[], signal?: AbortSignal): Promise<EmbedResult>;
}

export interface EmbedderOptions {
  /** Injected in tests. Never defaulted to a recorded fixture at runtime. */
  fetch?: typeof globalThis.fetch;
  /** OpenAI-compatible origin. Configurable so a gateway can be pointed at. */
  baseUrl?: string;
  timeoutMs?: number;
}

/**
 * One attempt must not outlive the shortest retry interval.
 *
 * If it did, a slow provider would leave attempts overlapping: the worker would
 * start a second attempt for a job whose first attempt is still in flight, and
 * the lease would be the only thing standing between that and a double charge.
 */
const DEFAULT_TIMEOUT_MS = EMBEDDING.backoffBaseSeconds * 1000;

export function createEmbedder(
  config: Pick<ServerConfig, 'generation' | 'embedding'>,
  options: EmbedderOptions = {},
): Embedder {
  const { mode, model, apiKey } = config.embedding;

  if (mode === 'fake') return fakeEmbedder(model);
  if (mode === 'unconfigured' || !apiKey) return unconfiguredEmbedder(model);
  return openAiEmbedder(model, apiKey, options);
}

/**
 * Deterministic pseudo-vectors derived from the text.
 *
 * Same text, same vector, no network, every run. These are not semantic: two
 * texts that mean the same thing get unrelated vectors. The fake exists to prove
 * the plumbing (dimension checks, hash guards, lease and retry behaviour), and
 * any test that asserts a *ranking* from it would be asserting nothing.
 */
export function fakeEmbedder(model = 'fake'): Embedder {
  return {
    mode: 'fake',
    model,
    embed: async (texts) => ({
      status: 'ok',
      model,
      vectors: texts.map((text) => deterministicVector(text)),
    }),
  };
}

export function unconfiguredEmbedder(model = 'unconfigured'): Embedder {
  return {
    mode: 'unconfigured',
    model,
    embed: async () => ({ status: 'not_configured', model }),
  };
}

export function openAiEmbedder(
  model: string,
  apiKey: string,
  options: EmbedderOptions = {},
): Embedder {
  const doFetch = options.fetch ?? globalThis.fetch;
  const baseUrl = (options.baseUrl ?? 'https://api.openai.com').replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    mode: 'live',
    model,
    async embed(texts, signal) {
      if (texts.length === 0) return { status: 'ok', model, vectors: [] };

      // No retry loop lives here. Retry policy, backoff and the attempt ceiling
      // belong to the worker, which is the only thing that knows how many
      // attempts this job has already spent.
      const timeout = AbortSignal.timeout(timeoutMs);
      const composed = signal ? AbortSignal.any([signal, timeout]) : timeout;

      let response: Response;
      try {
        response = await doFetch(`${baseUrl}/v1/embeddings`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({ model, input: [...texts] }),
          signal: composed,
        });
      } catch {
        // The thrown error can quote the request body. It is not propagated.
        return { status: 'failed', model, code: 'provider_timeout', retryable: true };
      }

      if (!response.ok) {
        return {
          status: 'failed',
          model,
          code: response.status === 429 ? 'rate_limited' : 'provider_unavailable',
          retryable: response.status === 429 || response.status >= 500,
        };
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        return { status: 'failed', model, code: 'provider_invalid_response', retryable: false };
      }

      const vectors = readVectors(payload, texts.length);
      if (!vectors) {
        return { status: 'failed', model, code: 'provider_invalid_response', retryable: false };
      }
      return { status: 'ok', model, vectors };
    },
  };
}

/**
 * Validates the provider's answer before it can reach the index.
 *
 * A wrong dimension is rejected rather than padded or truncated. C03 is explicit
 * that incompatible dimensions never share an index, and a silently reshaped
 * vector would corrupt every neighbour search against it without ever failing.
 */
function readVectors(payload: unknown, expectedCount: number): number[][] | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data) || data.length !== expectedCount) return null;

  const vectors: number[][] = [];
  for (const entry of data) {
    if (typeof entry !== 'object' || entry === null) return null;
    const values = (entry as { embedding?: unknown }).embedding;
    if (!Array.isArray(values) || values.length !== EMBEDDING.dimensions) return null;
    if (!values.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
    vectors.push(values as number[]);
  }
  return vectors;
}

/** FNV-1a over the text, expanded into a unit vector of the indexed dimension. */
function deterministicVector(text: string): number[] {
  const seed = fnv1a(text);
  const values = new Array<number>(EMBEDDING.dimensions);
  let state = seed;
  let sumSquares = 0;
  for (let i = 0; i < EMBEDDING.dimensions; i += 1) {
    // xorshift keeps the whole vector a function of the text, so the same text
    // always produces the same vector and two texts rarely collide.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state |= 0;
    const value = state / 2147483648;
    values[i] = value;
    sumSquares += value * value;
  }
  const norm = Math.sqrt(sumSquares) || 1;
  for (let i = 0; i < values.length; i += 1) values[i] = (values[i] ?? 0) / norm;
  return values;
}

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash | 0 || 1;
}
