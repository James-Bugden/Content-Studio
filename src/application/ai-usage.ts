import 'server-only';
import { randomUUID } from 'node:crypto';
import { AppError } from '@/domain/errors';
import type { AiCall, AiCapChange, AiFeature, AiUsage } from '@/domain/ai-usage';

export interface AiUsageRepository {
  summary(): Promise<AiUsage>;
  /** Atomic check + reservation. A repeated id must never authorise a second provider call. */
  begin(call: Omit<AiCall, 'timestamp' | 'status'>): Promise<void>;
  finish(call: Pick<AiCall, 'id' | 'model' | 'inputTokens' | 'outputTokens' | 'costMicros' | 'status'>): Promise<void>;
  setCap(change: AiCapChange): Promise<void>;
}

// USD / million tokens = microdollars / token. Standard global synchronous rates.
// Verified 2026-10-27: https://platform.claude.com/docs/en/about-claude/pricing
// https://developers.openai.com/api/docs/pricing (embeddings).
const PRICES: Record<string, readonly [number, number]> = {
  'claude-opus-5': [5, 25], 'claude-opus-5-5': [4, 20],
  'claude-sonnet-5': [2, 10], 'claude-sonnet-5-5': [2, 10],
  'claude-opus-4-6': [5, 25], 'claude-sonnet-4-6': [3, 15], 'claude-haiku-4-5': [1, 5],
  'claude-opus-4-5': [5, 25], 'claude-opus-4-7': [5, 25], 'claude-opus-4-8': [5, 25], 'claude-sonnet-4-5': [3, 15],
  'text-embedding-3-small': [0.02, 0], 'text-embedding-3-large': [0.13, 0],
  // Synthetic calls simulate Opus pricing; no real charge.
  'fake': [5, 25], 'fake-deterministic-v1': [5, 25],
};
export function estimatedAiCost(model: string, inputTokens: number, outputTokens: number): number {
  const key = model.replace(/-\d{8}$/, '');
  const rate = PRICES[key];
  if (!rate) throw new AppError('CONFIG_MISSING', { reason: 'ai_model_pricing_missing' });
  if (![inputTokens, outputTokens].every(n => Number.isSafeInteger(n) && n >= 0)) throw new AppError('VALIDATION_FAILED');
  return Math.ceil(inputTokens * rate[0] + outputTokens * rate[1]);
}

export type UsageTokens = { model: string; inputTokens?: number | null; outputTokens?: number | null; cacheCreationInputTokens?: number };
export class AiUsageService {
  constructor(readonly repository: AiUsageRepository) {}
  summary() { return this.repository.summary(); }
  setCap(change: AiCapChange) { return this.repository.setCap(change); }

  async track<T>(feature: AiFeature, model: string, inputTokens: number, maxOutputTokens: number,
    call: () => Promise<T>, tokens: (result: T) => UsageTokens): Promise<T> {
    const id = randomUUID();
    const reservation = { id, feature, model, inputTokens, outputTokens: maxOutputTokens,
      costMicros: estimatedAiCost(model, inputTokens, maxOutputTokens) };
    await this.repository.begin(reservation); // Fail closed before any provider work.
    let result: T;
    try { result = await call(); }
    catch (error) {
      // A timeout/transport failure can still be billed. Keep the reservation rather
      // than inventing zero usage; no prompts or provider error text are persisted.
      await this.repository.finish({ ...reservation, status: 'uncertain' });
      throw error;
    }
    const usage = tokens(result);
    const actualInput = usage.inputTokens ?? inputTokens;
    const actualOutput = usage.outputTokens ?? maxOutputTokens;
    let costMicros: number;
    // Cache hits use the full input rate; cache creation uses up to 2x input.
    // Keep actual token counts intact and make the cost conservative.
    try { costMicros = estimatedAiCost(usage.model, actualInput + (usage.cacheCreationInputTokens ?? 0), actualOutput); }
    catch { costMicros = Math.max(reservation.costMicros, actualInput * 15 + actualOutput * 75); }
    await this.repository.finish({ id, model: usage.model, inputTokens: actualInput, outputTokens: actualOutput, costMicros,
      status: usage.inputTokens == null || usage.outputTokens == null ? 'uncertain' : 'completed' });
    return result;
  }
}
