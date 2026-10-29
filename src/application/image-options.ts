import 'server-only';
import { z } from 'zod';
import { LAYOUT_GUIDE, MAX_FIRST_OPTIONS, MAX_MORE_OPTIONS, MAX_OPTIONS, draftProblems, imageLayoutSchema, imageOptionDraftSchema, normaliseDrafts, type ImageLayout, type ImageOption, type ImageOptionDraft } from '@/domain/image-options';
import { HOUSE_STYLE, SECURITY_RULES, wrapUntrusted } from './ai-prompt';
import type { AiTask } from './ports';

/**
 * The shared part of the image check (#248): how the model is asked for sketch
 * options, and the deterministic clean-up and checks every batch goes through.
 */
export const OPTIONS_INSTRUCTIONS = [
  `When an image is needed, also return "options": between 1 and ${MAX_FIRST_OPTIONS} different ASCII sketch options, best fit first. Return only the options that genuinely fit this post. One is fine; do not pad to ${MAX_FIRST_OPTIONS}.`,
  'Each option is {"title":"2-4 words, e.g. Comparison card","reason":"one short sentence on why this layout fits","layout":"<layout key>","sketch":"the ASCII sketch"}.',
  'Each option must use a different layout. Layout keys and what they suit:',
  LAYOUT_GUIDE,
  `A sketch is plain printable ASCII with line breaks: boxes drawn with + - |, arrows as -> or v, short labels. At most 30 lines and ${70} characters per line. Use only labels and facts that appear in the post. Never invent numbers, names, quotes or claims.`,
  'When no image is needed, return "options":[].',
].join('\n');

/** Clean a decision's options and check them; both feed the single repair request. */
export function normaliseDecisionOptions<T extends { needsImage?: boolean; verdict?: string; options: ImageOptionDraft[] }>(value: T): T {
  const needs = value.needsImage ?? value.verdict === 'needs_image';
  return { ...value, options: needs ? normaliseDrafts(value.options) : [] };
}
export function decisionProblems(value: { needsImage?: boolean; verdict?: string; options: ImageOptionDraft[] }): string[] {
  const needs = value.needsImage ?? value.verdict === 'needs_image';
  return needs ? draftProblems(value.options, { min: 1, max: MAX_FIRST_OPTIONS }) : [];
}

export type MoreOptionsInput = { title: string; draft: string; platform: string; shown: { layout: ImageLayout; title: string }[]; max: number };
export const moreOptionsSchema = z.object({ options: z.array(imageOptionDraftSchema).max(MAX_MORE_OPTIONS).default([]) }).strict();
export type MoreOptionsOutput = z.infer<typeof moreOptionsSchema>;
export { imageLayoutSchema };

/** Up to 3 further layouts the first batch did not use. An empty list is a valid answer. */
export const moreOptionsTask: AiTask<MoreOptionsOutput, MoreOptionsInput> = {
  name: 'ascii_sketch',
  promptVersion: 'image-more-248-v1',
  maxOutputTokens: 4500,
  system: [
    SECURITY_RULES, HOUSE_STYLE,
    'A post already has ASCII sketch options for an editorial diagram. Offer more, using layouts that are not among those already shown.',
    `Return {"options":[...]} with between 0 and the requested maximum (never more than ${MAX_MORE_OPTIONS}) of options that genuinely fit this post and differ clearly from what is shown. Return an empty list when nothing else fits.`,
    'Each option is {"title":"2-4 words","reason":"one short sentence on why it fits","layout":"<layout key>","sketch":"the ASCII sketch"}.',
    'Layout keys and what they suit:', LAYOUT_GUIDE,
    'A sketch is plain printable ASCII with line breaks, boxes drawn with + - |, arrows as -> or v, short labels, at most 30 lines and 70 characters per line. Use only labels and facts that appear in the post. Never invent numbers, names, quotes or claims.',
  ].join('\n'),
  render: input => wrapUntrusted('source_text', JSON.stringify(input)),
  schema: moreOptionsSchema,
  normalise: value => ({ options: normaliseDrafts(value.options) }),
  validate: (value, input) => draftProblems(value.options, { max: Math.min(input.max, MAX_MORE_OPTIONS), exclude: input.shown.map(s => s.layout) }),
};

export const shownLayouts = (options: readonly ImageOption[]) => options.map(o => ({ layout: o.layout, title: o.title }));
export const optionsRoom = (options: readonly ImageOption[]) => Math.max(0, Math.min(MAX_MORE_OPTIONS, MAX_OPTIONS - options.length));
