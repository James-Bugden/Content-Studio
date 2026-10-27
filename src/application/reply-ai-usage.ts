import 'server-only';
import { getAiUsage } from './ai-usage-container';
import { isAppError } from '@/domain/errors';
import { AppError as ReplyError } from '@/replies/lib/contracts/errors';
import type { ReplyGenerator } from '@/replies/lib/ai/types';
import type { Embedder } from '@/replies/lib/embeddings/provider';

export function trackReplyGenerator(generator: ReplyGenerator): ReplyGenerator {
  return { name: generator.name, model: generator.model, async complete(instruction, userContent, options) {
    try {
      return await getAiUsage().track(`replies_${options.task ?? 'ideas'}`, generator.name === 'fake' ? 'fake' : generator.model,
        Buffer.byteLength(instruction + userContent, 'utf8') + 1024, options.maxOutputTokens,
        () => generator.complete(instruction, userContent, options), result => ({
          model: generator.name === 'fake' ? 'fake' : result.model,
          inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens,
        }));
    } catch (error) {
      if (isAppError(error)) throw new ReplyError(error.code === 'AI_LIMIT_REACHED' ? 'monthly_ai_limit_reached' : 'provider_unavailable',
        error.code === 'AI_LIMIT_REACHED' ? 'Monthly AI limit reached' : 'AI usage could not be confirmed. Try again later.');
      throw error;
    }
  } };
}

export function trackEmbedder(embedder: Embedder): Embedder {
  if (embedder.mode === 'unconfigured') return embedder;
  return { mode: embedder.mode, model: embedder.model, async embed(texts, signal) {
    if (!texts.length) return embedder.embed(texts, signal);
    try {
      const estimate = texts.reduce((sum, text) => sum + Buffer.byteLength(text, 'utf8'), 0);
      return await getAiUsage().track('embeddings', embedder.mode === 'fake' ? 'fake' : embedder.model, estimate, 0,
        async () => {
          const result = await embedder.embed(texts, signal);
          if (result.status !== 'ok') throw new EmbeddingFailure(result);
          return result;
        }, result => ({ model: embedder.mode === 'fake' ? 'fake' : result.model, inputTokens: result.inputTokens, outputTokens: 0 }));
    } catch (error) {
      if (error instanceof EmbeddingFailure) return error.result;
      return { status: 'failed', model: embedder.model, code: isAppError(error) && error.code === 'AI_LIMIT_REACHED' ? 'monthly_ai_limit_reached' : 'provider_unavailable', retryable: false };
    }
  } };
}
class EmbeddingFailure extends Error {
  constructor(readonly result: Awaited<ReturnType<Embedder['embed']>>) { super('embedding failed'); }
}
