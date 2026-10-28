import { z } from 'zod';

/**
 * Title, alt text and tags for a bank image (#245).
 *
 * The model proposes; the owner edits before saving. Whatever it returns is
 * normalised here first, so a stray capital, a duplicate, a hashtag or a run-on
 * tag never reaches the form as if it were deliberate.
 */

export const MAX_SUGGESTED_TAGS = 8;
export const TAG_CHARS = 40;
export const TITLE_CHARS = 100;
export const ALT_CHARS = 250;

/** The model's answer. Strict, so extra keys are a failure rather than ignored. */
export const bankImageMetaOutputSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    altText: z.string().trim().min(1).max(500),
    tags: z.array(z.string()).max(30),
  })
  .strict();
export type BankImageMetaOutput = z.infer<typeof bankImageMetaOutputSchema>;

const oneLine = (text: string) => text.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();

export function normaliseTag(raw: string): string | null {
  const tag = oneLine(raw)
    .toLowerCase()
    .replace(/^#+/, '')
    .replace(/[^\p{L}\p{N} -]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (tag === '' || [...tag].length > TAG_CHARS) return null;
  return tag;
}

export function normaliseTags(raw: readonly string[], max: number = MAX_SUGGESTED_TAGS): string[] {
  const out: string[] = [];
  for (const entry of raw) {
    const tag = normaliseTag(entry);
    if (tag && !out.includes(tag)) out.push(tag);
    if (out.length >= max) break;
  }
  return out;
}

function clip(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max ? text : chars.slice(0, max).join('').trimEnd();
}

export function normaliseSuggestion(output: BankImageMetaOutput): { title: string; alt_text: string; tags: string[] } {
  const title = clip(oneLine(output.title).replace(/[.\s]+$/, ''), TITLE_CHARS);
  const alt = clip(oneLine(output.altText), ALT_CHARS);
  return { title, alt_text: alt, tags: normaliseTags(output.tags) };
}

/** What a person typed into the tags box: comma or newline separated. */
export function parseTagInput(text: string): string[] {
  return normaliseTags(text.split(/[,\n]/), 20);
}
