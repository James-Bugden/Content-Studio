import { z } from 'zod';
import { shortHash } from './hash';
import type { LibraryItem } from './records';
import { libraryIdSchema, operationIdSchema, revisionSchema } from './mutation';
import { MAX_FIRST_OPTIONS, imageOptionDraftSchema, type ImageOption } from './image-options';

const line = z.string().trim().min(1).max(240).refine(s => !/[\r\n]/.test(s));
export const imageDecisionSchema = z.object({ needsImage: z.boolean(), reason: line, options: z.array(imageOptionDraftSchema).max(MAX_FIRST_OPTIONS).default([]) }).strict();
export type ImageDecision = z.infer<typeof imageDecisionSchema>;
export const sketchSchema = z.object({
  title: z.string().trim().min(1).max(100).regex(/^[\x20-\x7e]+$/),
  blocks: z.array(z.string().trim().min(1).max(80).regex(/^[\x20-\x7e]+$/)).min(2).max(4),
  grammar: z.enum(['list', 'contrast', 'flow', 'matrix', 'single-idea']),
  altText: line,
}).strict();
export type ImageSketch = z.infer<typeof sketchSchema>;
export function asciiSketch(sketch: ImageSketch): string {
  return [sketch.title, '', ...sketch.blocks.flatMap((b, i) => [ ...(i ? ['    |', '    v'] : []), `+${'-'.repeat(b.length + 2)}+`, `| ${b} |`, `+${'-'.repeat(b.length + 2)}+`])].join('\n');
}
const sketchText = z.string().min(1).max(8000);
export const imageActionSchema = z.object({
  libraryId: libraryIdSchema, expectedRevision: revisionSchema, operationId: operationIdSchema,
  action: z.enum(['check', 'revise', 'approve', 'create', 'store', 'choose', 'more', 'force']), note: z.string().trim().max(1000).optional(),
  /** `store`: the one-click check already holds the verdict; the server validates and saves it. */
  reason: line.optional(), options: z.array(imageOptionDraftSchema).min(1).max(MAX_FIRST_OPTIONS).optional(),
  /** `choose`: the option to approve, with the owner's edited sketch when they changed it. */
  optionId: z.string().regex(/^[a-z0-9]{8}$/).optional(), sketch: sketchText.optional(),
}).strict()
  .refine(v => v.action !== 'revise' || Boolean(v.note), { path: ['note'], message: 'Add a revision note.' })
  .refine(v => v.action !== 'store' || Boolean(v.options && v.reason), { path: ['options'], message: 'Options and a reason are required.' })
  .refine(v => v.action !== 'choose' || Boolean(v.optionId), { path: ['optionId'], message: 'Choose an option.' })
  .refine(v => v.action === 'store' || (!v.options && !v.reason), { path: ['options'], message: 'Only store takes options.' })
  .refine(v => v.action === 'choose' || (!v.optionId && !v.sketch), { path: ['optionId'], message: 'Only choose takes an option.' });
export type ImageAction = z.infer<typeof imageActionSchema>;
export type ImageState = { libraryId: string; revision: string; sketch: string; approval: 'none' | 'pending' | 'approved' | 'stale'; reason: string; hasImage: boolean; imageUrl?: string;
  /** The saved verdict: the owner's decision on the row. */
  decision: 'needs_image' | 'no_image' | 'undecided';
  /** Ranked sketch options from the image check (up to 9). */
  options: ImageOption[];
  /** The option whose sketch is the current approved one, when known. */
  chosenId?: string };
export type ImageOutcome = { ok: true; image: ImageState; /** `more` found no further layout that fits. */ noMore?: boolean } | { ok: false; code: string; message: string };
/** The small stamp also identifies pipeline posts in projections that omit sketches. */
export function hasImageSketch(visual: LibraryItem['visual']): boolean {
  return Boolean(visual.sketch) || /\[cs:sketch-source:[a-f0-9]{8}\]/.test(visual.imageNextAction);
}

export function sketchSource(item: LibraryItem): string {
  return shortHash(JSON.stringify([item.currentHook, item.draftContent, item.targetPlatform]));
}
export function sketchMaterial(item: LibraryItem): string {
  return shortHash(JSON.stringify([item.currentHook, item.draftContent, item.targetPlatform, item.visual.source, item.visual.sketch, item.visual.brief, item.visual.altText]));
}
export function sketchApproval(item: LibraryItem): ImageState['approval'] {
  if (!item.visual.sketch) return 'none';
  if (item.visual.source.kind !== 'original_graphic') return 'stale';
  const source = /\[cs:sketch-source:([a-f0-9]{8})\]/.exec(item.visual.imageNextAction);
  if (!source || source[1] !== sketchSource(item)) return 'stale';
  const stamp = /\[cs:sketch:([a-f0-9]{8})\]/.exec(item.visual.imageNextAction);
  return !stamp ? 'pending' : stamp[1] === sketchMaterial(item) ? 'approved' : 'stale';
}

/** Only small identifiers/revisions enter a run. Full posts stay on the server. */
export const IMAGE_RUN_LIMIT = 25;
export async function runImageBatch<T extends { libraryId: string }, R>(
  items: readonly T[], run: (item: T) => Promise<R>, progress: (id: string, state: 'running' | 'done' | 'failed', result?: R) => void,
  succeeded: (result: R) => boolean, concurrency = 3,
): Promise<{ succeeded: number; failed: number }> {
  if (items.length > IMAGE_RUN_LIMIT || new Set(items.map(i => i.libraryId)).size !== items.length) throw new Error('Select up to 25 posts per run.');
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 3) throw new Error('Invalid concurrency');
  let cursor = 0, passed = 0, failed = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++]!;
      progress(item.libraryId, 'running');
      try {
        const result = await run(item);
        const ok = succeeded(result);
        if (ok) passed++; else failed++;
        progress(item.libraryId, ok ? 'done' : 'failed', result);
      } catch { failed++; progress(item.libraryId, 'failed'); }
    }
  }));
  return { succeeded: passed, failed };
}
