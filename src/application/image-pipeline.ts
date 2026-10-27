import 'server-only';
import { z } from 'zod';
import { AppError, ERROR_CATALOGUE, isAppError } from '@/domain/errors';
import { imageActionSchema, imageDecisionSchema, sketchSchema, asciiSketch, sketchApproval, sketchMaterial, sketchSource, type ImageAction, type ImageOutcome, type ImageState } from '@/domain/image-pipeline';
import { shortHash } from '@/domain/hash';
import type { Actor } from '@/domain/mutation';
import type { LibraryRecord } from '@/domain/records';
import type { LibraryPatch } from '@/domain/mapping';
import { formatRenderNote } from '@/domain/stage';
import { formatVisualVersion, parseBrief, parseVisualVersion, type VisualBrief } from '@/domain/visual';
import { rendererBriefSchema, type ImageRenderer } from '@/integrations/image-renderer/port';
import { ImageRenderError } from '@/integrations/image-renderer/http';
import catalogue from '@/integrations/image-renderer/catalogue.json';
import { SECURITY_RULES, HOUSE_STYLE, wrapUntrusted } from './ai-prompt';
import type { AiGateway, AiTask, ContentRepository, DriveGateway } from './ports';
import { assetFileName } from './visuals';

export type ImageInput = { title: string; draft: string; sketch?: string; note?: string; platform: string };
function task<T>(name: AiTask<T, ImageInput>['name'], schema: z.ZodType<T>, instructions: string): AiTask<T, ImageInput> {
  return { name, schema, promptVersion: 'image-243-v1', maxOutputTokens: 2200,
    system: [SECURITY_RULES, HOUSE_STYLE, instructions].join('\n'),
    render: input => wrapUntrusted('source_text', JSON.stringify(input)),
  };
}
export const imageCheckTask = task('image_check', imageDecisionSchema,
  'Decide whether this post benefits from an original editorial diagram. Text only is often best. Return exactly {"needsImage":boolean,"reason":"one short sentence"}. Never change or approve post copy.');
export const asciiSketchTask = task('ascii_sketch', sketchSchema,
  'Propose one simple diagram in the SOAR editorial style. 2-4 short labelled blocks joined by arrows. British English and printable ASCII only. Return exactly {"title":"short heading","blocks":["short label","short label"],"grammar":"flow","altText":"one sentence"}. grammar may be list, contrast, flow, matrix or single-idea. Follow the revision note as editorial data.');
export const imageRenderTask = task('image_render', rendererBriefSchema,
  'Map the approved ASCII sketch and post to the original SOAR tool brief. Keep the approved lesson, labels and relationships. Choose the simplest appropriate format from the catalogue. Do not invent data or facts. Only English is supported. Return exactly {format,title,fields,alt_text,platform,language:"en",example_label?}. Title must not end in a full stop. No em dashes or semicolons. Short labels must fit at 40px. Catalogue fields use ["array", elementSchema, minimum, maximum]; "text" means non-empty text, "number" a finite number. Include an Example or Schematic caveat only where required. Full schema catalogue:\n' + JSON.stringify(catalogue));

export function imageState(record: LibraryRecord): ImageState {
  const v = record.value.visual;
  return { libraryId: record.value.libraryId, revision: record.revision, sketch: v.sketch ?? '', approval: sketchApproval(record.value),
    reason: v.imageNextAction.replace(/\[cs:[^\]]+\]/g, '').trim(), hasImage: v.source.kind !== 'text_only' && Boolean(v.imageFile),
    ...(v.source.kind !== 'text_only' && v.imageFile ? { imageUrl: `/api/library/${encodeURIComponent(record.value.libraryId)}/asset` } : {}) };
}

type Dependencies = { repo: ContentRepository; drive: DriveGateway; ai: AiGateway; renderer: ImageRenderer };
function failure(code: keyof typeof ERROR_CATALOGUE, message?: string): ImageOutcome {
  return { ok: false, code, message: message ?? ERROR_CATALOGUE[code].message };
}
async function model<T>(ai: AiGateway, definition: AiTask<T, ImageInput>, input: ImageInput): Promise<T> {
  const result = await ai.run(definition, input);
  if (!result.ok) throw new AppError(result.code);
  return result.value;
}

/** Same-process replays share in-flight work. Saved operation fingerprints cover
 * cold-start retries; SQL still owns final CAS, idempotency and audit/history. */
const pending = new Map<string, { hash: string; run: Promise<ImageOutcome> }>();
// Like Visuals' upload recovery, retain an exact patch after an uncertain save
// so a same-process retry never uploads another asset or regenerates its brief.
const prepared = new Map<string, { hash: string; patch: LibraryPatch }>();
export async function runImageAction(deps: Dependencies, actor: Actor, raw: ImageAction): Promise<ImageOutcome> {
  if (actor.role !== 'owner') return failure('FORBIDDEN');
  const parsed = imageActionSchema.safeParse(raw);
  if (!parsed.success) return failure('VALIDATION_FAILED');
  if (deps.repo.capability().state !== 'ready') return failure('FORBIDDEN');
  if (deps.repo.mutationProvider?.() !== 'db' && deps.repo.capability().provider !== 'db') return failure('CONFIG_MISSING', 'Image checks require the database Content store.');
  const input = parsed.data;
  const hash = shortHash(JSON.stringify(input));
  const key = `${actor.sub}:${input.libraryId}:${input.operationId}`;
  const prior = pending.get(key);
  if (prior) return prior.hash === hash ? prior.run : failure('CONFLICT');
  const run = execute(deps, actor, input, hash, key).catch(error => failure(isAppError(error) ? error.code : 'PROVIDER_UNAVAILABLE',
    error instanceof ImageRenderError ? `${error.label} does not fit or is unsupported. Shorten that label or revise the sketch.` : undefined));
  pending.set(key, { hash, run });
  try { return await run; } finally { if (pending.get(key)?.run === run) pending.delete(key); }
}

async function execute({ repo, drive, ai, renderer }: Dependencies, actor: Actor, input: ImageAction, hash: string, key: string): Promise<ImageOutcome> {
  const record = await repo.getLibrary(input.libraryId, true);
  const item = record.value;
  const existing = new RegExp(`\\[cs:image-op:${input.operationId}:([a-f0-9]{8})\\]`).exec(item.visual.imageNextAction);
  if (existing) return existing[1] === hash ? { ok: true, image: imageState(record) } : failure('CONFLICT');
  if (record.revision !== input.expectedRevision) return failure('STALE_READ', 'This post changed. Reload it before trying again.');
  const cached = prepared.get(key);
  if (cached) {
    if (cached.hash !== hash) return failure('CONFLICT');
    const saved = await repo.updateLibrary({ operationId: input.operationId, actor, target: { libraryId: input.libraryId }, expectedRevision: input.expectedRevision, patch: cached.patch });
    if (saved.ok) { prepared.delete(key); return { ok: true, image: imageState(saved.value) }; }
    return failure(saved.code);
  }
  if (!item.targetPlatform.ok) return failure('VALIDATION_FAILED');
  const data: ImageInput = { title: item.currentHook || item.slug, draft: item.draftContent, sketch: item.visual.sketch, note: input.note, platform: item.targetPlatform.value.toLowerCase() };
  if (!data.draft.trim()) return failure('VALIDATION_FAILED', 'Write the post before checking images.');
  const patch: LibraryPatch = {};
  let note: string;
  if (input.action === 'check' || input.action === 'revise') {
    if (input.action === 'revise' && !item.visual.sketch) return failure('GATE_BLOCKED', 'Check images first.');
    const decision = input.action === 'check' ? await model(ai, imageCheckTask, data) : { needsImage: true, reason: 'Sketch revised. Review it before creating the image.' };
    Object.assign(patch, { hasImage: decision.needsImage ? 'TRUE' : 'FALSE', imageStatus: decision.needsImage ? 'Brief Ready' : 'Not Needed',
      visualSource: decision.needsImage ? 'Original graphic' : 'Text only', imageBrief: '', imageSketch: '' });
    note = decision.reason;
    if (decision.needsImage) {
      const sketch = await model(ai, asciiSketchTask, data);
      const ascii = asciiSketch(sketch);
      const brief: VisualBrief = { lesson: sketch.title, grammar: sketch.grammar, asciiPlan: ascii, mainIdeas: sketch.blocks,
        lineBrokenCopy: sketch.title, focalPhrase: sketch.title, placement: 'feed-portrait', altText: sketch.altText };
      Object.assign(patch, { imageSketch: ascii, imageBrief: JSON.stringify(brief), imageAltText: sketch.altText });
    }
  } else if (input.action === 'approve') {
    const state = sketchApproval(item);
    if (state !== 'pending' && state !== 'approved') return failure('GATE_BLOCKED', state === 'stale' ? 'The post changed. Revise the sketch before approving.' : 'Check images first.');
    note = `Sketch approved [cs:sketch:${sketchMaterial(item)}]`;
  } else {
    if (sketchApproval(item) !== 'approved') return failure('GATE_BLOCKED', 'Approve the current sketch before creating an image.');
    const brief = await model(ai, imageRenderTask, data);
    if (brief.platform !== data.platform) return failure('VALIDATION_FAILED', 'The image platform does not match this post.');
    const rendered = await renderer.render(brief);
    // Refuse a changed draft before uploading; the final CAS fences a change
    // during upload. New Drive assets never overwrite an existing file.
    if ((await repo.getLibrary(input.libraryId, true)).revision !== record.revision) return failure('STALE_READ');
    const revision = (parseVisualVersion(item.visual.version)?.revision ?? 0) + 1;
    if (revision > 999) return failure('GATE_BLOCKED');
    const version = formatVisualVersion({ system: 'SOAR-v1.1', platform: item.targetPlatform.value, language: 'en', revision });
    const file = await drive.createFile({ name: assetFileName(item.libraryId, { revision, platform: item.targetPlatform.value, language: 'en' }).replace(/\.svg$/, '.png'), mimeType: 'image/png', bytes: rendered.png });
    // Preserve the standard Visuals brief. Sidecar records the original renderer,
    // exact PNG digest and copy for later guarded asset approval.
    const imageBrief = JSON.stringify({ ...parseBrief(item.visual.brief), altText: brief.alt_text, editorial: rendered.sidecar });
    Object.assign(patch, { imageFile: file.webLink, imageAltText: brief.alt_text, visualVersion: version, imageStatus: 'Needs Review', hasImage: 'TRUE', imageBrief });
    const nextItem = { ...item, visual: { ...item.visual, brief: imageBrief, altText: brief.alt_text } };
    note = `${formatRenderNote(imageBrief, version, file.webLink)} [cs:sketch:${sketchMaterial(nextItem)}]`;
  }
  patch.imageNextAction = `${note} [cs:sketch-source:${sketchSource(item)}] [cs:image-op:${input.operationId}:${hash}]`;
  prepared.set(key, { hash, patch });
  if (prepared.size > 50) prepared.delete(prepared.keys().next().value!);
  const saved = await repo.updateLibrary({ operationId: input.operationId, actor, target: { libraryId: input.libraryId }, expectedRevision: input.expectedRevision, patch });
  if (!saved.ok) return failure(saved.code, input.action === 'create' ? 'The image was uploaded, but the post could not be linked. Reload the post before retrying.' : undefined);
  prepared.delete(key);
  return { ok: true, image: imageState(saved.value) };
}
