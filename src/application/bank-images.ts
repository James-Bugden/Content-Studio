import 'server-only';
import { createHash } from 'node:crypto';
import type { ErrorCode } from '@/domain/errors';
import { asciiSketch } from '@/domain/image-pipeline';
import type { ImageRenderer } from '@/integrations/image-renderer/port';
import { AppError as ReplyError } from '@/replies/lib/contracts/errors';
export { sketchStamp } from '@/replies/lib/images/bank-image';
import { bankImageMetaOutputSchema, normaliseSuggestion, type BankImageMetaOutput } from '@/replies/lib/images/tags';
import { HOUSE_STYLE, SECURITY_RULES, wrapUntrusted } from './ai-prompt';
import { asciiSketchTask, imageRenderTask, type ImageInput } from './image-pipeline';
import type { AiGateway, AiTask } from './ports';

/**
 * The AI half of the Replies image bank (#245).
 *
 * Three calls, all through the one AI gateway so every one is counted against the
 * monthly cap and refused at it:
 *   * tags: title, alt text and tags for an uploaded image (one small call);
 *   * sketch: the existing ASCII-sketch task, for "Create new";
 *   * render: the existing image_render task plus the editorial renderer.
 *
 * Nothing here stores anything. The routes decide what is saved, after the owner
 * has seen it.
 */

export type BankImageTagsInput = { fileName: string; hint: string };

export const BANK_IMAGE_TAGS_TASK: AiTask<BankImageMetaOutput, BankImageTagsInput> = {
  name: 'bank_image_tags',
  promptVersion: 'bank_image_tags.v1',
  maxOutputTokens: 500,
  system: [
    'You label one image for a personal image bank used when replying on social media about careers and hiring.',
    'You are given only the file name and, optionally, the owner\'s short note about what the image shows. You cannot see the image, so describe only what that text supports and never invent detail.',
    'Return JSON: {"title": string, "altText": string, "tags": string[]}.',
    'title: at most 8 words, no full stop. altText: one plain sentence describing what the image shows, for a screen reader. tags: 3 to 6 lowercase topic words or short phrases, no hashtags.',
    HOUSE_STYLE,
    SECURITY_RULES,
  ].join('\n'),
  render: (input) => wrapUntrusted('source_text', JSON.stringify({ fileName: input.fileName, note: input.hint })),
  schema: bankImageMetaOutputSchema,
};

/** Failure codes from the main-app gateway, in the Replies envelope's vocabulary. */
export function replyErrorForAi(code: ErrorCode): ReplyError {
  if (code === 'AI_LIMIT_REACHED') return new ReplyError('monthly_ai_limit_reached', 'Monthly AI limit reached');
  if (code === 'CONFIG_MISSING') return new ReplyError('not_configured', 'Image help is not set up yet. Everything else still works.');
  return new ReplyError('provider_unavailable', "Couldn't do that just now. Nothing was changed.");
}

export async function suggestBankImageMeta(
  ai: AiGateway,
  input: BankImageTagsInput,
  signal?: AbortSignal,
): Promise<{ title: string; alt_text: string; tags: string[] }> {
  const result = await ai.run(BANK_IMAGE_TAGS_TASK, input, signal ? { signal } : {});
  if (!result.ok) throw replyErrorForAi(result.code);
  return normaliseSuggestion(result.value);
}

export interface BankSketch {
  /** The printable ASCII plan shown for approval. */
  sketch: string;
  altText: string;
}

function inputFor(args: { title: string; brief: string; platform: string; sketch?: string; note?: string }): ImageInput {
  return {
    title: args.title,
    draft: args.brief,
    platform: args.platform,
    ...(args.sketch ? { sketch: args.sketch } : {}),
    ...(args.note ? { note: args.note } : {}),
  };
}

export async function sketchBankImage(
  ai: AiGateway,
  args: { title: string; brief: string; platform: string; note?: string },
): Promise<BankSketch> {
  const result = await ai.run(asciiSketchTask, inputFor(args));
  if (!result.ok) throw replyErrorForAi(result.code);
  return { sketch: asciiSketch(result.value), altText: result.value.altText };
}

export interface BankRender {
  png: Uint8Array;
  altText: string;
  sha256: string;
}

export async function renderBankImage(
  ai: AiGateway,
  renderer: ImageRenderer,
  args: { title: string; brief: string; sketch: string; platform: string },
): Promise<BankRender> {
  const result = await ai.run(imageRenderTask, inputFor(args));
  if (!result.ok) throw replyErrorForAi(result.code);
  if (result.value.platform !== args.platform) {
    throw new ReplyError('provider_invalid_response', 'The image did not match the platform. Nothing was saved.');
  }
  let rendered;
  try {
    rendered = await renderer.render(result.value);
  } catch {
    throw new ReplyError('provider_unavailable', 'The image could not be created. Shorten the labels or revise the sketch.');
  }
  return {
    png: rendered.png,
    altText: result.value.alt_text,
    sha256: createHash('sha256').update(rendered.png).digest('hex'),
  };
}
