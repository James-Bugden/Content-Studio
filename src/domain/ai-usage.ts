import { z } from 'zod';

export const aiFeatureSchema = z.enum(['image_check', 'ascii_sketch', 'image_render', 'image_need', 'english_qa', 'hooks', 'zh_tw', 'zh_qa', 'replies_ideas', 'replies_rewrite', 'replies_translation', 'embeddings']);
export type AiFeature = z.infer<typeof aiFeatureSchema>;
export const aiCallSchema = z.object({
  id: z.string().uuid(), timestamp: z.iso.datetime({ offset: true }), feature: aiFeatureSchema, model: z.string().min(1).max(100),
  inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative(),
  costMicros: z.number().int().nonnegative(), status: z.enum(['pending', 'completed', 'uncertain']),
});
export type AiCall = z.infer<typeof aiCallSchema>;
export const aiUsageSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/), resetsAt: z.iso.datetime({ offset: true }), spentMicros: z.number().int().nonnegative(),
  capMicros: z.number().int().min(0).max(1_000_000_000), version: z.number().int().positive(), calls: z.array(aiCallSchema).max(25),
});
export type AiUsage = z.infer<typeof aiUsageSchema>;
export const aiCapSchema = z.object({
  operationId: z.string().uuid(), expectedVersion: z.number().int().positive(), capMicros: z.number().int().min(0).max(1_000_000_000),
}).strict();
export type AiCapChange = z.infer<typeof aiCapSchema> & { actorHash: string };

/** Integer microdollars avoid floating point accumulation. Taipei calendar months. */
export function aiMonth(now: Date): { month: string; resetsAt: string } {
  const local = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const month = local.toISOString().slice(0, 7);
  return { month, resetsAt: new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1) - 8 * 60 * 60 * 1000).toISOString() };
}
export function aiUsageLevel(spentMicros: number, capMicros: number): 'normal' | 'warning' | 'blocked' {
  return spentMicros >= capMicros ? 'blocked' : spentMicros * 5 >= capMicros * 4 ? 'warning' : 'normal';
}
