import 'server-only';
import { z } from 'zod';
import type { Platform } from '@/domain/enums';
import type { ErrorCode } from '@/domain/errors';
import { fingerprint } from '@/domain/hash';
import { libraryIdSchema } from '@/domain/mutation';
import { MAX_FIRST_OPTIONS, imageOptionDraftSchema, type ImageOptionDraft } from '@/domain/image-options';
import { OPTIONS_INSTRUCTIONS, decisionProblems, normaliseDecisionOptions } from './image-options';
import { HOUSE_STYLE, SECURITY_RULES, wrapUntrusted } from './ai-prompt';
import type { AiGateway, AiMeta, AiTask } from './ports';

/**
 * Does this post need an image? (#242)
 *
 * One advisory verdict with a one-line reason for the exact draft the editor
 * sent. When an image is needed the same call returns 1 to 3 ASCII sketch
 * options (#248), so the one-click check stays a single call per post.
 * Nothing is written here; the editor saves the verdict and options through the
 * guarded image actions. Runs through the AI gateway, so every
 * call is tracked against the monthly spend cap.
 */
export type ImageNeedInput = { draft: string; platform: Platform };
export const imageNeedOutputSchema = z.object({
  verdict: z.enum(['needs_image', 'no_image']),
  reason: z.string().trim().min(1).max(240),
  options: z.array(imageOptionDraftSchema).max(MAX_FIRST_OPTIONS).default([]),
}).strict();
export type ImageNeedOutput = z.infer<typeof imageNeedOutputSchema>;

export const MAX_IMAGE_NEED_CHARS = 40_000;

export const IMAGE_NEED_TASK: AiTask<ImageNeedOutput, ImageNeedInput> = {
  name: 'image_need',
  promptVersion: 'image_need.v2',
  maxOutputTokens: 4500,
  system: [
    'You decide whether a short professional social post about careers and hiring needs an image.',
    'Answer needs_image when a diagram, checklist graphic, comparison or other visual would make the point clearer or noticeably stronger than text alone (steps, frameworks, before/after, numbers, scripts).',
    'Answer no_image when the post works as plain text (a story, an opinion, a single idea).',
    'reason is one plain sentence, 160 characters or fewer, that does not quote the post.',
    'Return JSON: {"verdict": "needs_image" | "no_image", "reason": string, "options": [...]}.',
    OPTIONS_INSTRUCTIONS,
    HOUSE_STYLE,
    SECURITY_RULES,
  ].join('\n'),
  render: (input) => [`Platform: ${input.platform}`, 'Decide for this draft:', wrapUntrusted('source_text', input.draft)].join('\n'),
  schema: imageNeedOutputSchema,
  normalise: normaliseDecisionOptions,
  validate: decisionProblems,
};

export type ImageNeedRun =
  | { ok: true; verdict: ImageNeedOutput['verdict']; reason: string; options: ImageOptionDraft[]; draftHash: string; meta: AiMeta }
  | { ok: false; code: ErrorCode; meta?: AiMeta };

export async function runImageNeed(args: {
  ai: AiGateway;
  libraryId: string;
  draft: string;
  draftHash: string;
  platform: Platform;
  signal?: AbortSignal;
}): Promise<ImageNeedRun> {
  if (!libraryIdSchema.safeParse(args.libraryId).success) return { ok: false, code: 'VALIDATION_FAILED' };
  if (args.draft.trim() === '' || args.draft.length > MAX_IMAGE_NEED_CHARS) return { ok: false, code: 'VALIDATION_FAILED' };
  if (fingerprint(args.draft) !== args.draftHash) return { ok: false, code: 'STALE_READ' };
  const result = await args.ai.run(IMAGE_NEED_TASK, { draft: args.draft, platform: args.platform }, args.signal ? { signal: args.signal } : {});
  if (!result.ok) return { ok: false, code: result.code, meta: result.meta };
  return { ok: true, verdict: result.value.verdict, reason: result.value.reason, options: result.value.options, draftHash: args.draftHash, meta: result.meta };
}
