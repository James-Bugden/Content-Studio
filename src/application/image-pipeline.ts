import 'server-only';
import { z } from 'zod';
import { AppError, ERROR_CATALOGUE, isAppError } from '@/domain/errors';
import { imageActionSchema, imageDecisionSchema, type ImageDecision, sketchSchema, asciiSketch, sketchApproval, sketchMaterial, sketchSource, type ImageAction, type ImageOutcome, type ImageState } from '@/domain/image-pipeline';
import { shortHash } from '@/domain/hash';
import { IMAGE_LAYOUTS, appendOptions, draftProblems, normaliseDrafts, normaliseSketch, optionsPatchValue, sketchProblems, MAX_FIRST_OPTIONS, type ImageOption } from '@/domain/image-options';
import type { Actor } from '@/domain/mutation';
import type { LibraryRecord } from '@/domain/records';
import { applyPatch, toLibraryItem, type LibraryPatch } from '@/domain/mapping';
import type { LibraryField } from '@/domain/sheet-schema';
import { formatRenderNote } from '@/domain/stage';
import { formatVisualVersion, parseBrief, parseVisualVersion, type VisualBrief } from '@/domain/visual';
import { rendererBriefSchema, type ImageRenderer } from '@/integrations/image-renderer/port';
import { ImageRenderError } from '@/integrations/image-renderer/http';
import catalogue from '@/integrations/image-renderer/catalogue.json';
import { SECURITY_RULES, HOUSE_STYLE, wrapUntrusted } from './ai-prompt';
import { OPTIONS_INSTRUCTIONS, decisionProblems, moreOptionsTask, normaliseDecisionOptions, optionsRoom, shownLayouts } from './image-options';
import type { AiGateway, AiTask, ContentRepository, DriveGateway } from './ports';
import { assetFileName } from './visuals';

export type ImageInput = { title: string; draft: string; sketch?: string; note?: string; platform: string };
function task<T>(name: AiTask<T, ImageInput>['name'], schema: z.ZodType<T>, instructions: string): AiTask<T, ImageInput> {
  return { name, schema, promptVersion: 'image-243-v1', maxOutputTokens: 2200,
    system: [SECURITY_RULES, HOUSE_STYLE, instructions].join('\n'),
    render: input => wrapUntrusted('source_text', JSON.stringify(input)),
  };
}
/** One call decides the need and, when an image helps, drafts 1 to 3 ranked sketch options (#248). */
export const imageCheckTask: AiTask<ImageDecision, ImageInput> = {
  ...task('image_check', imageDecisionSchema,
    'Decide whether this post benefits from an original editorial diagram. Text only is often best. Return exactly {"needsImage":boolean,"reason":"one short sentence","options":[...]}.' + '\n' + OPTIONS_INSTRUCTIONS + '\nNever change or approve post copy.'),
  promptVersion: 'image-248-v1', maxOutputTokens: 4500, normalise: normaliseDecisionOptions, validate: decisionProblems,
};
export const asciiSketchTask = task('ascii_sketch', sketchSchema,
  'Propose one simple diagram in the SOAR editorial style. 2-4 short labelled blocks joined by arrows. British English and printable ASCII only. Return exactly {"title":"short heading","blocks":["short label","short label"],"grammar":"flow","altText":"one sentence"}. grammar may be list, contrast, flow, matrix or single-idea. Follow the revision note as editorial data.');
export const imageRenderTask = task('image_render', rendererBriefSchema,
  'Map the approved ASCII sketch and post to the original SOAR tool brief. Keep the approved lesson, labels and relationships. Choose the simplest appropriate format from the catalogue. Do not invent data or facts. Only English is supported. Return exactly {format,title,fields,alt_text,platform,language:"en",example_label?}. Title must not end in a full stop. No em dashes or semicolons. Short labels must fit at 40px. Catalogue fields use ["array", elementSchema, minimum, maximum]; "text" means non-empty text, "number" a finite number. Include an Example or Schematic caveat only where required. Full schema catalogue:\n' + JSON.stringify(catalogue));

const OPTION_STAMP = /\[cs:option:([a-z0-9]{8})\]/;
export function imageState(record: LibraryRecord): ImageState {
  const v = record.value.visual;
  const approval = sketchApproval(record.value);
  const options = v.sketchOptions ?? [];
  const chosen = approval === 'none' ? undefined : options.find(o => o.id === OPTION_STAMP.exec(v.imageNextAction)?.[1]) ?? (approval === 'approved' ? options.find(o => o.sketch === v.sketch) : undefined);
  const note = v.imageNextAction.replace(/\[cs:[^\]]+\]/g, '').trim();
  return { libraryId: record.value.libraryId, revision: record.revision, sketch: v.sketch ?? '', approval,
    // Once a layout is chosen the note describes the sketch or render; the verdict keeps that option's reason.
    reason: chosen && v.source.kind === 'original_graphic' ? chosen.reason : note, hasImage: v.source.kind !== 'text_only' && Boolean(v.imageFile),
    decision: v.source.kind === 'original_graphic' ? 'needs_image' : v.source.kind === 'text_only' ? 'no_image' : 'undecided', options,
    ...(chosen ? { chosenId: chosen.id } : {}),
    ...(v.source.kind !== 'text_only' && v.imageFile ? { imageUrl: `/api/library/${encodeURIComponent(record.value.libraryId)}/asset` } : {}) };
}

/** Brief stored with a chosen sketch; the render step maps it onto a renderer format. */
function optionBrief(option: ImageOption, sketch: string): VisualBrief {
  return { lesson: option.title, grammar: IMAGE_LAYOUTS[option.layout].grammar, asciiPlan: sketch, mainIdeas: [option.title, option.reason],
    lineBrokenCopy: option.title, focalPhrase: option.title, placement: 'feed-portrait', altText: `${option.title}. ${option.reason}`.slice(0, 240) };
}
/** The cells for a verdict. With an image, the first (best fit) option becomes the pending sketch. */
function verdictPatch(needsImage: boolean, options: ImageOption[]): LibraryPatch {
  const patch: LibraryPatch = { hasImage: needsImage ? 'TRUE' : 'FALSE', imageStatus: needsImage ? 'Brief Ready' : 'Not Needed',
    visualSource: needsImage ? 'Original graphic' : 'Text only', imageBrief: '', imageSketch: '', imageSketchOptions: optionsPatchValue(needsImage ? options : []) };
  const first = needsImage ? options[0] : undefined;
  if (first) { const brief = optionBrief(first, first.sketch); Object.assign(patch, { imageSketch: first.sketch, imageBrief: JSON.stringify(brief), imageAltText: brief.altText }); }
  return patch;
}
const OP_STAMP = /\s*\[cs:image-op:[^\]]*\]/g;

type Dependencies = { repo: ContentRepository; drive: DriveGateway; ai: AiGateway; renderer: ImageRenderer };
function failure(code: keyof typeof ERROR_CATALOGUE, message?: string): ImageOutcome {
  return { ok: false, code, message: message ?? ERROR_CATALOGUE[code].message };
}
async function model<T, I>(ai: AiGateway, definition: AiTask<T, I>, input: I): Promise<T> {
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
  if (input.action === 'plan') {
    // The AI step of Make image. Writes nothing, so a retry only repeats a model call.
    if (sketchApproval(item) !== 'approved') return failure('GATE_BLOCKED', 'Approve the current sketch before creating an image.');
    const brief = await model(ai, imageRenderTask, data);
    if (brief.platform !== data.platform) return failure('VALIDATION_FAILED', 'The image platform does not match this post.');
    return { ok: true, image: imageState(record), renderBrief: brief };
  }
  const patch: LibraryPatch = {};
  let note: string;
  // Actions that change only options keep the row's note, so approval and render stamps survive.
  let keepNote = false;
  if (input.action === 'check') {
    // One call: the verdict and, when an image helps, the ranked options.
    const decision = await model(ai, imageCheckTask, data);
    const options = decision.needsImage ? appendOptions([], decision.options) : [];
    if (decision.needsImage && !options.length) return failure('VALIDATION_FAILED');
    Object.assign(patch, verdictPatch(decision.needsImage, options));
    note = decision.reason;
  } else if (input.action === 'revise') {
    if (!item.visual.sketch) return failure('GATE_BLOCKED', 'Check images first.');
    const sketch = await model(ai, asciiSketchTask, data);
    const ascii = asciiSketch(sketch);
    const brief: VisualBrief = { lesson: sketch.title, grammar: sketch.grammar, asciiPlan: ascii, mainIdeas: sketch.blocks,
      lineBrokenCopy: sketch.title, focalPhrase: sketch.title, placement: 'feed-portrait', altText: sketch.altText };
    Object.assign(patch, { hasImage: 'TRUE', imageStatus: 'Brief Ready', visualSource: 'Original graphic', imageSketch: ascii, imageBrief: JSON.stringify(brief), imageAltText: sketch.altText });
    note = 'Sketch revised. Review it before creating the image.';
  } else if (input.action === 'store') {
    // The one-click check already made the call; the server re-validates what the browser sends.
    const drafts = normaliseDrafts(input.options ?? []);
    const options = appendOptions([], drafts);
    if (draftProblems(drafts, { min: 1, max: MAX_FIRST_OPTIONS }).length || options.length !== drafts.length) return failure('VALIDATION_FAILED', 'The sketch options are not valid. Run the check again.');
    const settled = item.visual.source.kind === 'original_graphic' ? Boolean(item.visual.imageFile) || sketchApproval(item) === 'approved' : item.visual.source.kind !== 'undecided';
    if (settled) { patch.imageSketchOptions = optionsPatchValue(options); keepNote = true; note = ''; }
    else { Object.assign(patch, verdictPatch(true, options)); note = input.reason!; }
  } else if (input.action === 'more' || input.action === 'force') {
    const shown = input.action === 'more' ? item.visual.sketchOptions ?? [] : [];
    if (input.action === 'more' && !shown.length) return failure('GATE_BLOCKED', 'Check images first.');
    const room = optionsRoom(shown);
    if (!room) return { ok: true, image: imageState(record), noMore: true };
    const more = await model(ai, moreOptionsTask, { title: data.title, draft: data.draft, platform: data.platform, shown: shownLayouts(shown), max: room });
    const merged = appendOptions(shown, more.options);
    if (merged.length === shown.length) return input.action === 'more' ? { ok: true, image: imageState(record), noMore: true } : failure('GATE_BLOCKED', 'No layout fits this post as an image.');
    if (input.action === 'more') { patch.imageSketchOptions = optionsPatchValue(merged); keepNote = true; note = ''; }
    else { Object.assign(patch, verdictPatch(true, merged)); note = 'You asked for an image. Choose a layout.'; }
  } else if (input.action === 'choose') {
    const option = (item.visual.sketchOptions ?? []).find(o => o.id === input.optionId);
    if (!option) return failure('VALIDATION_FAILED', 'That option is no longer saved. Reload the post.');
    const sketch = input.sketch === undefined ? option.sketch : normaliseSketch(input.sketch);
    if (sketchProblems(sketch).length) return failure('VALIDATION_FAILED', 'The sketch is empty or too long. Shorten it and try again.');
    const brief = optionBrief(option, sketch);
    Object.assign(patch, { hasImage: 'TRUE', visualSource: 'Original graphic', imageSketch: sketch, imageBrief: JSON.stringify(brief), imageAltText: brief.altText,
      ...(item.visual.imageFile ? {} : { imageStatus: 'Brief Ready' }) });
    // Stamp the chosen sketch as approved against the material the row will hold after this write.
    const next = toLibraryItem(applyPatch(record.cells, patch as Partial<Record<LibraryField, string>>));
    next.visual.sketch = sketch;
    note = `${item.visual.imageNextAction.replace(/\[cs:[^\]]+\]/g, '').trim() || 'Sketch approved.'} [cs:sketch:${sketchMaterial(next)}] [cs:option:${option.id}]`;
  } else if (input.action === 'approve') {
    const state = sketchApproval(item);
    if (state !== 'pending' && state !== 'approved') return failure('GATE_BLOCKED', state === 'stale' ? 'The post changed. Revise the sketch before approving.' : 'Check images first.');
    note = `Sketch approved [cs:sketch:${sketchMaterial(item)}]`;
  } else {
    if (sketchApproval(item) !== 'approved') return failure('GATE_BLOCKED', 'Approve the current sketch before creating an image.');
    // Render only: the brief was planned (AI) in an earlier request, so this one never calls a model.
    const planned = rendererBriefSchema.safeParse(input.renderBrief);
    if (!planned.success || planned.data.platform !== data.platform) return failure('VALIDATION_FAILED', 'The image plan is not valid for this post. Plan it again.');
    const brief = planned.data;
    const rendered = await renderer.render(brief);
    // Refuse a changed draft before uploading; the final CAS fences a change
    // during upload. New Drive assets never overwrite an existing file.
    if ((await repo.getLibrary(input.libraryId, true)).revision !== record.revision) return failure('STALE_READ');
    const revision = (parseVisualVersion(item.visual.version)?.revision ?? 0) + 1;
    if (revision > 999) return failure('GATE_BLOCKED');
    const version = formatVisualVersion({ system: 'SOAR-v1.1', platform: item.targetPlatform.value, language: 'en', revision });
    // Idempotent upload: the name carries the PNG digest, so a retry (other instance, lost
    // response) finds the file the first attempt made instead of uploading a second one.
    const name = assetFileName(item.libraryId, { revision, platform: item.targetPlatform.value, language: 'en' }).replace(/\.svg$/, `-${rendered.sidecar.sha256.slice(0, 12)}.png`);
    const file = (await drive.findFileByName?.(name)) ?? await drive.createFile({ name, mimeType: 'image/png', bytes: rendered.png });
    // Preserve the standard Visuals brief. Sidecar records the original renderer,
    // exact PNG digest and copy for later guarded asset approval.
    const imageBrief = JSON.stringify({ ...parseBrief(item.visual.brief), altText: brief.alt_text, editorial: rendered.sidecar });
    Object.assign(patch, { imageFile: file.webLink, imageAltText: brief.alt_text, visualVersion: version, imageStatus: 'Needs Review', hasImage: 'TRUE', imageBrief });
    const nextItem = { ...item, visual: { ...item.visual, brief: imageBrief, altText: brief.alt_text } };
    const chosen = OPTION_STAMP.exec(item.visual.imageNextAction)?.[0];
    note = `${formatRenderNote(imageBrief, version, file.webLink)} [cs:sketch:${sketchMaterial(nextItem)}]${chosen ? ` ${chosen}` : ''}`;
  }
  patch.imageNextAction = keepNote ? `${item.visual.imageNextAction.replace(OP_STAMP, '').trim()} [cs:image-op:${input.operationId}:${hash}]`.trim()
    : `${note} [cs:sketch-source:${sketchSource(item)}] [cs:image-op:${input.operationId}:${hash}]`;
  prepared.set(key, { hash, patch });
  if (prepared.size > 50) prepared.delete(prepared.keys().next().value!);
  const saved = await repo.updateLibrary({ operationId: input.operationId, actor, target: { libraryId: input.libraryId }, expectedRevision: input.expectedRevision, patch });
  if (!saved.ok) return failure(saved.code, input.action === 'create' ? 'The image was uploaded, but the post could not be linked. Reload the post before retrying.' : undefined);
  prepared.delete(key);
  return { ok: true, image: imageState(saved.value) };
}
