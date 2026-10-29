import { z } from 'zod';
import { shortHash } from './hash';

/**
 * ASCII sketch options for the image check (#248).
 *
 * One AI call decides whether a post needs an image and, when it does, returns
 * 1 to 3 sketch options ranked by fit. The count is adaptive: only layouts that
 * genuinely fit are returned. More can be requested later (up to 9 in total).
 * `layout` names a relationship family that maps onto the renderer's format
 * catalogue (image-renderer/FORMAT-TOPIC-MAP-v2.md); the render step still picks
 * the final format from the approved sketch.
 */
export const MAX_FIRST_OPTIONS = 3;
export const MAX_MORE_OPTIONS = 3;
export const MAX_OPTIONS = 9;
export const MAX_SKETCH_CHARS = 3000;
export const MAX_SKETCH_LINES = 40;
export const MAX_SKETCH_LINE = 100;

export const IMAGE_LAYOUTS = {
  comparison: { label: 'Comparison', grammar: 'contrast', formats: ['E01'], hint: 'two options side by side across a few dimensions' },
  before_after: { label: 'Before and after', grammar: 'contrast', formats: ['E02'], hint: 'a weak version revised into a strong one' },
  steps: { label: 'Steps', grammar: 'flow', formats: ['E03', 'N04'], hint: 'a short ordered sequence, or a repeating loop' },
  decision: { label: 'Decision', grammar: 'flow', formats: ['E04'], hint: 'a question with a yes path and a no path' },
  annotated: { label: 'Annotated example', grammar: 'list', formats: ['E05'], hint: 'one example with three callouts' },
  sources: { label: 'Sources to result', grammar: 'flow', formats: ['E06'], hint: 'three inputs that feed one view' },
  worksheet: { label: 'Fill-in worksheet', grammar: 'list', formats: ['E07'], hint: 'three labelled prompts to complete' },
  proof: { label: 'Need and proof', grammar: 'list', formats: ['E09', 'N10'], hint: 'pairs of need and evidence, or a claim with proofs' },
  dialogue: { label: 'Dialogue', grammar: 'contrast', formats: ['E10'], hint: 'a question and an answer between two speakers' },
  quadrant: { label: 'Quadrant', grammar: 'matrix', formats: ['N01'], hint: 'two criteria on two axes' },
  spectrum: { label: 'Spectrum', grammar: 'matrix', formats: ['N02'], hint: 'positions between a low and a high end' },
  funnel: { label: 'Narrowing stages', grammar: 'flow', formats: ['N03'], hint: 'three stages that filter down' },
  timeline: { label: 'Timeline', grammar: 'flow', formats: ['N05'], hint: 'four dated milestones' },
  ladder: { label: 'Ladder', grammar: 'list', formats: ['N06'], hint: 'four levels from lower to higher' },
  overlap: { label: 'Overlap', grammar: 'matrix', formats: ['N08'], hint: 'three sets and what they share' },
  layers: { label: 'Layers', grammar: 'list', formats: ['N09'], hint: 'three stacked parts, each with its copy' },
} as const;
export type ImageLayout = keyof typeof IMAGE_LAYOUTS;
export const imageLayoutSchema = z.enum(Object.keys(IMAGE_LAYOUTS) as [ImageLayout, ...ImageLayout[]]);
export const layoutLabel = (layout: ImageLayout): string => IMAGE_LAYOUTS[layout].label;

const line = (max: number) => z.string().trim().min(1).max(max).refine(s => !/[\r\n]/.test(s), 'Single line only.');
/** What the model returns for one option. Sketch limits are enforced after normalising. */
export const imageOptionDraftSchema = z.object({
  title: line(60), reason: line(160), layout: imageLayoutSchema, sketch: z.string().min(1).max(8000),
}).strict();
export type ImageOptionDraft = z.infer<typeof imageOptionDraftSchema>;

/** The stored shape: a draft plus a stable id. */
export const imageOptionSchema = imageOptionDraftSchema.extend({ id: z.string().regex(/^[a-z0-9]{8}$/) }).strict();
export type ImageOption = z.infer<typeof imageOptionSchema>;
export const imageOptionsSchema = z.array(imageOptionSchema).max(MAX_OPTIONS);

const PUNCTUATION: Record<string, string> = { '‘': "'", '’': "'", '“': '"', '”': '"', '–': '-', '—': '-', '→': '->', '←': '<-', '•': '*', '…': '...' };
/** Deterministic clean-up: printable ASCII and newlines only, no trailing spaces, no leading or trailing blank lines. */
export function normaliseSketch(text: string): string {
  const ascii = text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').replace(/[‘’“”–—→←•…]/g, c => PUNCTUATION[c] ?? '')
    .replace(/[^\x20-\x7e\n]/g, '');
  return ascii.split('\n').map(l => l.replace(/\s+$/, '')).join('\n').replace(/^\n+|\n+$/g, '');
}
/** Problems with an already normalised sketch, by path only. */
export function sketchProblems(sketch: string, path = 'sketch'): string[] {
  const problems: string[] = [];
  if (sketch.replace(/\s/g, '').length < 6) problems.push(`${path}: too short`);
  if (sketch.length > MAX_SKETCH_CHARS) problems.push(`${path}: over ${MAX_SKETCH_CHARS} characters`);
  const lines = sketch.split('\n');
  if (lines.length > MAX_SKETCH_LINES) problems.push(`${path}: over ${MAX_SKETCH_LINES} lines`);
  if (lines.some(l => l.length > MAX_SKETCH_LINE)) problems.push(`${path}: a line is over ${MAX_SKETCH_LINE} characters`);
  return problems;
}

export function normaliseDrafts(drafts: readonly ImageOptionDraft[]): ImageOptionDraft[] {
  return drafts.map(d => ({ ...d, sketch: normaliseSketch(d.sketch) }));
}
/**
 * Semantic checks for a batch of drafts, by path only (they feed the one repair
 * request). `exclude` holds layouts already shown; a new batch must not repeat them.
 */
export function draftProblems(drafts: readonly ImageOptionDraft[], opts: { max: number; min?: number; exclude?: readonly ImageLayout[] }): string[] {
  const problems: string[] = [];
  if (drafts.length < (opts.min ?? 0)) problems.push(`options: return at least ${opts.min}`);
  if (drafts.length > opts.max) problems.push(`options: return at most ${opts.max}`);
  const seen = new Set<string>(opts.exclude ?? []);
  const sketches = new Set<string>();
  drafts.forEach((d, i) => {
    problems.push(...sketchProblems(d.sketch, `options.${i}.sketch`));
    if (seen.has(d.layout)) problems.push(`options.${i}.layout: duplicate or already shown`);
    seen.add(d.layout);
    if (sketches.has(d.sketch)) problems.push(`options.${i}.sketch: identical to another option`);
    sketches.add(d.sketch);
  });
  return problems;
}

export const optionId = (draft: Pick<ImageOptionDraft, 'layout' | 'sketch'>): string => shortHash(`${draft.layout}\n${draft.sketch}`);
/** Drafts become stored options. Ids are content hashes; options already stored (same id or layout) are skipped; the total never passes 9. */
export function appendOptions(existing: readonly ImageOption[], drafts: readonly ImageOptionDraft[]): ImageOption[] {
  const out = [...existing];
  for (const d of normaliseDrafts(drafts)) {
    if (out.length >= MAX_OPTIONS) break;
    const id = optionId(d);
    if (out.some(o => o.id === id || o.layout === d.layout)) continue;
    out.push({ id, title: d.title, reason: d.reason, layout: d.layout, sketch: d.sketch });
  }
  return out;
}
/** Column value for a patch: JSON text, or empty to clear. */
export const optionsPatchValue = (options: readonly ImageOption[]): string => options.length ? JSON.stringify(options) : '';
export function parseStoredOptions(raw: unknown): ImageOption[] {
  const parsed = imageOptionsSchema.safeParse(typeof raw === 'string' ? safeJson(raw) : raw);
  return parsed.success ? parsed.data : [];
}
function safeJson(text: string): unknown { try { return JSON.parse(text); } catch { return null; } }
/** What the model is told about shown layouts, so a repeat is easy to avoid. */
export const LAYOUT_GUIDE = Object.entries(IMAGE_LAYOUTS).map(([key, v]) => `${key}: ${v.hint}`).join('\n');
