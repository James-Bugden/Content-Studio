import 'server-only';
import { z } from 'zod';
import { languageFor, type Platform } from '@/domain/enums';
import { AppError, isAppError, type ErrorCode } from '@/domain/errors';
import { evaluateLibraryGates, type Gate, type ScreenshotUse } from '@/domain/gates';
import { shortHash } from '@/domain/hash';
import { parseDriveFileId } from '@/domain/links';
import type { LibraryPatch } from '@/domain/mapping';
import type { Actor, StepResult } from '@/domain/mutation';
import type { LibraryItem, LibraryRecord, ScheduleRecord } from '@/domain/records';
import { formatRenderNote, formatVisualApprovalNote, renderStampMatches, visualApprovalState, visualMaterial } from '@/domain/stage';
import {
  formatVisualSource,
  parseBrief,
  parseVisualSource,
  parseVisualVersion,
  validateBrief,
  formatVisualVersion,
  type BriefProblem,
  type VisualBrief,
} from '@/domain/visual';
import { renderBriefSvg, type RenderProblem } from '@/domain/visual-render';
import { reuseCheck, serializeBrief, type DecisionKind, type ReuseCheck, type VisualItemView, type VisualList } from '@/domain/visual-studio';
import type { ContentRepository, DriveGateway } from './ports';
import { screenshotUses } from './review';

/**
 * Visual Studio services (CS-012, VIS-02..VIS-06).
 *
 * The Sheet's existing visual cells stay the only record: `Visual Source`,
 * `Image Status`, `Image Brief` (structured JSON), `Image File`, `Image Alt Text`,
 * `Visual Version` and `Image Next Action` (approval stamp). Every write re-reads
 * the row, re-runs the gates server-side and goes through the repository's
 * expected-revision and operation-id contract. Rendering never approves; approval
 * quotes the exact version, file and material hash it was given for.
 */

const VISUAL_GATE = /^(VISUAL_|SCREENSHOT_)/;

function platformOf(item: LibraryItem): Platform | null {
  return item.targetPlatform.ok ? item.targetPlatform.value : null;
}

function decisionKind(item: LibraryItem): DecisionKind {
  return item.visual.source.kind;
}

const DECISION_LABEL: Record<DecisionKind, string> = {
  undecided: 'Not decided',
  text_only: 'Text only',
  original_graphic: 'Original graphic',
  screenshot: 'Screenshot',
  invalid: 'Unrecognised decision',
};

function usesFor(item: LibraryItem, library: LibraryRecord[], schedule: ScheduleRecord[] | null): ScreenshotUse[] | null {
  if (item.visual.source.kind !== 'screenshot') return [];
  return schedule === null ? null : screenshotUses(item, library, schedule);
}

function completeBrief(item: LibraryItem): VisualBrief | null {
  const brief = parseBrief(item.visual.brief);
  return brief && validateBrief(brief).length === 0 ? (brief as VisualBrief) : null;
}

export function toVisualView(record: LibraryRecord, library: LibraryRecord[], schedule: ScheduleRecord[] | null): VisualItemView {
  const item = record.value;
  const v = item.visual;
  const platform = platformOf(item);
  const language = platform ? languageFor(platform) : null;
  const kind = decisionKind(item);
  const uses = usesFor(item, library, schedule);
  const reuse: ReuseCheck = kind === 'screenshot' ? reuseCheck(platform, uses) : { state: 'not_applicable', uses: [], message: '' };
  const result = evaluateLibraryGates(item, { purpose: 'review', screenshotUses: uses });
  const gates = [...result.blockers, ...result.warnings].filter((g) => VISUAL_GATE.test(g.code));

  const brief = parseBrief(v.brief);
  const briefUnreadable = v.brief.trim() !== '' && brief === null;
  const briefProblems: BriefProblem[] = kind === 'original_graphic' ? validateBrief(brief) : [];
  const complete = kind === 'original_graphic' && briefProblems.length === 0 ? (brief as VisualBrief) : null;
  const renderProblems: RenderProblem[] = complete && platform && language ? renderBriefSvg(complete, { language, platform, revision: 0 }).problems : [];
  const approval = visualApprovalState(v);
  const status = v.imageStatus.ok ? v.imageStatus.value : `Unrecognised: ${v.imageStatus.raw}`;
  const version = parseVisualVersion(v.version);
  const formula = record.formulaFields.includes('imageNextAction');
  const rendered = kind === 'original_graphic' && version !== null && v.imageFile.trim() !== '';
  const preview: VisualItemView['preview'] = !rendered ? 'none' : approval === 'approved' || renderStampMatches(v) ? 'current' : 'changed';

  let reviewable: VisualItemView['reviewable'];
  if (kind === 'text_only') reviewable = { ok: false, reason: 'Text only needs no image approval.' };
  else if (kind === 'undecided') reviewable = { ok: false, reason: 'Choose a visual decision first.' };
  else if (kind === 'invalid') reviewable = { ok: false, reason: 'Visual Source is not a recognised decision. Choose one here.' };
  else if (approval === 'approved') reviewable = { ok: false, reason: 'This exact revision is already approved.' };
  else if (formula) reviewable = { ok: false, reason: 'Image Next Action holds a formula, so the approval stamp cannot be written there.' };
  else if (kind === 'screenshot') {
    if (reuse.state === 'same_platform' || reuse.state === 'uncertain') reviewable = { ok: false, reason: reuse.message };
    else if (v.altText.trim() === '') reviewable = { ok: false, reason: 'Write alt text for the screenshot first.' };
    else reviewable = { ok: true };
  } else if (briefProblems.length > 0) reviewable = { ok: false, reason: 'Complete the brief first.' };
  else if (renderProblems.length > 0) reviewable = { ok: false, reason: 'Fix the layout problems in the brief first.' };
  else if (approval === 'stale') reviewable = { ok: false, reason: 'The approved revision no longer matches. Render a new revision, then approve it.' };
  else if (!version || v.imageFile.trim() === '') reviewable = { ok: false, reason: 'Render a revision first.' };
  else if (preview !== 'current') reviewable = { ok: false, reason: 'The brief, version or file changed after this revision was rendered. Render a new revision.' };
  else if (!platform || version.platform !== platform || version.language !== language) {
    reviewable = { ok: false, reason: 'This revision was rendered for another platform or language. Render a new revision.' };
  } else if (!v.imageStatus.ok || v.imageStatus.value !== 'Needs Review') reviewable = { ok: false, reason: 'Render a revision first.' };
  else reviewable = { ok: true };

  let canRender: VisualItemView['canRender'];
  if (kind !== 'original_graphic') canRender = { ok: false, reason: 'Only original graphics are rendered here.' };
  else if (!platform || !language) canRender = { ok: false, reason: 'The target platform is not recognised.' };
  else if (briefProblems.length > 0) canRender = { ok: false, reason: 'Complete the brief first: 2 to 4 main ideas and every required field.' };
  else if (renderProblems.length > 0) canRender = { ok: false, reason: 'Fix the layout problems first.' };
  else if (v.version.trim() !== '' && !version) canRender = { ok: false, reason: 'Visual Version holds an unrecognised value. Fix it in the Sheet first.' };
  else if (approval === 'approved') canRender = { ok: false, reason: 'This revision is approved. Edit the brief to make a new one.' };
  else if ((version?.revision ?? 0) >= 999) canRender = { ok: false, reason: 'The revision counter is full.' };
  else canRender = { ok: true, nextVersion: formatVisualVersion({ system: 'SOAR-v1.1', revision: (version?.revision ?? 0) + 1, platform, language }) };

  return {
    libraryId: item.libraryId,
    revision: record.revision,
    slug: item.slug,
    platform,
    platformLabel: item.targetPlatform.ok ? item.targetPlatform.value : `Unrecognised: ${item.targetPlatform.raw}`,
    language,
    decision: kind,
    decisionLabel: kind === 'screenshot' && v.source.kind === 'screenshot' ? `Screenshot ${v.source.screenshotId}` : DECISION_LABEL[kind],
    screenshotId: v.source.kind === 'screenshot' ? v.source.screenshotId : null,
    imageStatus: status,
    brief,
    briefUnreadable,
    briefProblems,
    renderProblems,
    altText: v.altText,
    version: v.version,
    hasFile: v.imageFile.trim() !== '',
    fileHash: v.imageFile.trim() === '' ? '' : shortHash(`file:${v.imageFile}`),
    approval,
    preview,
    material: shortHash(visualMaterial(v)),
    reuse,
    gates,
    needsAction: gates.some((g) => g.severity === 'hard'),
    reviewable,
    canRender,
    imageNextActionIsFormula: formula,
  };
}

async function readSchedule(repo: ContentRepository): Promise<ScheduleRecord[] | null> {
  try {
    return await repo.listSchedule();
  } catch {
    return null;
  }
}

export async function loadVisualItems(repo: ContentRepository): Promise<VisualList> {
  const library = await repo.listLibrary();
  const schedule = await readSchedule(repo);
  const items = library.filter((r) => r.value.libraryId !== '').map((r) => toVisualView(r, library, schedule));
  // Items needing a decision or review first; otherwise Sheet order.
  const ordered = [...items.filter((i) => i.needsAction), ...items.filter((i) => !i.needsAction)];
  return { items: ordered, scheduleUnavailable: schedule === null };
}

type Loaded = { library: LibraryRecord[]; schedule: ScheduleRecord[] | null; record: LibraryRecord; view: VisualItemView };

async function load(repo: ContentRepository, libraryId: string): Promise<Loaded> {
  const library = await repo.listLibrary();
  const found = library.filter((r) => r.value.libraryId === libraryId);
  if (found.length === 0) throw new AppError('NOT_FOUND');
  if (found.length > 1) throw new AppError('CONFLICT', { reason: 'duplicate_id' });
  const schedule = await readSchedule(repo);
  const record = found[0]!;
  return { library, schedule, record, view: toVisualView(record, library, schedule) };
}

export async function loadVisualItem(repo: ContentRepository, libraryId: string): Promise<{ item: VisualItemView; scheduleUnavailable: boolean }> {
  const { view, schedule } = await load(repo, libraryId);
  return { item: view, scheduleUnavailable: schedule === null };
}

// ------------------------------------------------------------------ mutations

const base = {
  operationId: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/),
  libraryId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),
  expectedRevision: z.string().regex(/^[0-9a-f]{16}$/),
};

export const briefInputSchema = z.object({
  lesson: z.string().max(300),
  grammar: z.enum(['list', 'contrast', 'flow', 'matrix', 'single-idea']),
  asciiPlan: z.string().max(2000),
  // Up to 8 accepted so a fifth idea is reported as a brief problem, not a 400 (VIS-02).
  mainIdeas: z.array(z.string().max(200)).max(8),
  lineBrokenCopy: z.string().max(1000),
  focalPhrase: z.string().max(120),
  caveat: z.string().max(200).optional(),
  illustrativeReconstruction: z.boolean().optional(),
  placement: z.enum(['feed-square', 'feed-portrait', 'inline']),
  altText: z.string().max(500),
});

export const decisionSchema = z.union([z.literal('text_only'), z.literal('original_graphic'), z.object({ screenshotId: z.string().trim().min(3).max(120) })]);

export const visualActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('decide'), ...base, decision: decisionSchema }),
  z.object({ action: z.literal('brief'), ...base, brief: briefInputSchema }),
  z.object({ action: z.literal('render'), ...base }),
  z.object({
    action: z.literal('approve'),
    ...base,
    version: z.string().max(80),
    fileHash: z.string().regex(/^([0-9a-f]{8})?$/),
    material: z.string().regex(/^[0-9a-f]{8}$/),
  }),
  z.object({ action: z.literal('check_screenshot'), libraryId: base.libraryId, screenshotId: z.string().trim().min(1).max(120) }),
]);
export type VisualAction = z.infer<typeof visualActionSchema>;

type Base = { operationId: string; libraryId: string; expectedRevision: string };

export type VisualOutcome =
  | { ok: true; item: VisualItemView; replayed: boolean; note?: string; reuse?: ReuseCheck }
  | {
      ok: false;
      code: ErrorCode;
      message?: string;
      blockers?: Gate[];
      problems?: (BriefProblem | RenderProblem)[];
      reuse?: ReuseCheck;
      current?: VisualItemView;
      steps?: StepResult[];
    };

function blocked(message: string, extra: Omit<Extract<VisualOutcome, { ok: false }>, 'ok' | 'code' | 'message'> = {}): VisualOutcome {
  return { ok: false, code: 'GATE_BLOCKED', message, ...extra };
}

/**
 * Owner check and a fresh read. The repository enforces the expected revision on
 * every write (and recognises a lost-response replay of the same operation), so
 * only steps with a side effect before the Sheet write (the Drive upload) check it
 * up front.
 */
async function begin(repo: ContentRepository, actor: Actor, input: Base, opts: { checkRevision: boolean } = { checkRevision: false }): Promise<Loaded | VisualOutcome> {
  if (actor.role !== 'owner') return { ok: false, code: 'FORBIDDEN' };
  let loaded: Loaded;
  try {
    loaded = await load(repo, input.libraryId);
  } catch (error) {
    return { ok: false, code: isAppError(error) ? error.code : 'PROVIDER_UNAVAILABLE' };
  }
  if (opts.checkRevision && loaded.record.revision !== input.expectedRevision) {
    return { ok: false, code: 'STALE_READ', message: 'This item changed in the Sheet after you opened it. Nothing was written.', current: loaded.view };
  }
  return loaded;
}

function isOutcome(x: Loaded | VisualOutcome): x is VisualOutcome {
  return 'ok' in x;
}

async function write(repo: ContentRepository, actor: Actor, input: Base, loaded: Loaded, patch: LibraryPatch, extra: { note?: string; reuse?: ReuseCheck; steps?: StepResult[] } = {}): Promise<VisualOutcome> {
  const result = await repo.updateLibrary({ operationId: input.operationId, actor, target: { libraryId: input.libraryId }, expectedRevision: input.expectedRevision, patch });
  if (!result.ok) {
    const steps = [...(extra.steps ?? []), ...result.steps];
    if (result.code === 'STALE_READ' || result.code === 'CONFLICT') {
      const fresh = await load(repo, input.libraryId).catch(() => null);
      return { ok: false, code: result.code, steps, ...(fresh ? { current: fresh.view } : {}) };
    }
    return { ok: false, code: result.code, steps };
  }
  const library = loaded.library.map((r) => (r.value.libraryId === input.libraryId ? result.value : r));
  return {
    ok: true,
    replayed: result.replayed,
    item: toVisualView(result.value, library, loaded.schedule),
    ...(extra.note ? { note: extra.note } : {}),
    ...(extra.reuse ? { reuse: extra.reuse } : {}),
  };
}

/** Read-only reuse check for a screenshot id typed into the chooser (VIS-05). */
export async function checkScreenshot(repo: ContentRepository, libraryId: string, screenshotId: string): Promise<VisualOutcome> {
  const loaded = await load(repo, libraryId);
  const parsed = parseVisualSource(screenshotId);
  if (parsed.kind !== 'screenshot') {
    return { ok: false, code: 'VALIDATION_FAILED', message: 'That is not a screenshot identifier. Use the exact id, for example SHOT-2026-014.' };
  }
  const item = loaded.record.value;
  const hypothetical: LibraryItem = { ...item, visual: { ...item.visual, source: parsed } };
  const uses = usesFor(hypothetical, loaded.library, loaded.schedule);
  return { ok: true, replayed: false, item: loaded.view, reuse: reuseCheck(platformOf(item), uses) };
}

export async function decideVisual(
  repo: ContentRepository,
  actor: Actor,
  input: Base & { decision: z.infer<typeof decisionSchema> },
): Promise<VisualOutcome> {
  const loaded = await begin(repo, actor, input);
  if (isOutcome(loaded)) return loaded;
  const item = loaded.record.value;
  const current = item.visual.source;
  const canNote = !loaded.record.formulaFields.includes('imageNextAction');
  const patch: LibraryPatch = {};
  let note: string;
  let reuse: ReuseCheck | undefined;

  if (input.decision === 'text_only') {
    if (current.kind === 'text_only') return { ok: true, replayed: false, item: loaded.view, note: 'Already Text only. Nothing changed.' };
    patch.visualSource = 'Text only';
    patch.imageStatus = 'Not Needed';
    note = 'No image needed';
  } else if (input.decision === 'original_graphic') {
    if (current.kind === 'original_graphic') return { ok: true, replayed: false, item: loaded.view, note: 'Already Original graphic. Nothing changed.' };
    const complete = completeBrief(item);
    patch.visualSource = 'Original graphic';
    patch.imageStatus = complete ? 'Brief Ready' : 'Needs Brief';
    note = complete ? 'Render a revision' : 'Write the visual brief';
  } else {
    const parsed = parseVisualSource(input.decision.screenshotId);
    if (parsed.kind !== 'screenshot') {
      return { ok: false, code: 'VALIDATION_FAILED', message: 'That is not a screenshot identifier. Use the exact id, for example SHOT-2026-014.' };
    }
    if (current.kind === 'screenshot' && current.screenshotId === parsed.screenshotId) {
      return { ok: true, replayed: false, item: loaded.view, reuse: loaded.view.reuse, note: 'This screenshot is already the decision. Nothing changed.' };
    }
    const hypothetical: LibraryItem = { ...item, visual: { ...item.visual, source: parsed } };
    reuse = reuseCheck(platformOf(item), usesFor(hypothetical, loaded.library, loaded.schedule));
    if (reuse.state === 'same_platform' || reuse.state === 'uncertain') {
      const code = reuse.state === 'same_platform' ? 'SCREENSHOT_REUSED' : 'SCREENSHOT_UNCERTAIN';
      const gate: Gate = { code, severity: 'hard', field: 'Visual Source', message: reuse.message, nextAction: 'Use Text only or a fresh original graphic', human: true };
      return blocked(reuse.message, { reuse, blockers: [gate], current: loaded.view });
    }
    patch.visualSource = formatVisualSource(parsed);
    patch.imageStatus = 'Needs Review';
    note = 'Review the screenshot and its alt text';
  }
  if (canNote) patch.imageNextAction = note;
  return write(repo, actor, input, loaded, patch, reuse ? { reuse } : {});
}

function normaliseBrief(b: z.infer<typeof briefInputSchema>): VisualBrief {
  const caveat = (b.caveat ?? '').trim();
  return {
    lesson: b.lesson.trim(),
    grammar: b.grammar,
    asciiPlan: b.asciiPlan.replace(/\r\n?/g, '\n').replace(/\s+$/u, ''),
    mainIdeas: b.mainIdeas.map((i) => i.trim()).filter((i) => i !== ''),
    // Exact copy: only line endings are normalised; line breaks are the author's.
    lineBrokenCopy: b.lineBrokenCopy.replace(/\r\n?/g, '\n'),
    focalPhrase: b.focalPhrase,
    ...(caveat ? { caveat } : {}),
    ...(b.illustrativeReconstruction ? { illustrativeReconstruction: true } : {}),
    placement: b.placement,
    altText: b.altText.trim(),
  };
}

export async function saveBrief(repo: ContentRepository, actor: Actor, input: Base & { brief: z.infer<typeof briefInputSchema> }): Promise<VisualOutcome> {
  const loaded = await begin(repo, actor, input);
  if (isOutcome(loaded)) return loaded;
  const item = loaded.record.value;
  if (item.visual.source.kind !== 'original_graphic') return blocked('Choose Original graphic before writing a brief.', { current: loaded.view });
  const brief = normaliseBrief(input.brief);
  const serialized = serializeBrief(brief);
  const problems = validateBrief(brief);
  if (serialized === item.visual.brief && brief.altText === item.visual.altText) {
    return { ok: true, replayed: false, item: loaded.view, note: 'The brief is unchanged. Nothing was written.' };
  }
  const patch: LibraryPatch = { imageBrief: serialized, imageAltText: brief.altText };
  const wasApproved = item.visual.imageStatus.ok && item.visual.imageStatus.value === 'Approved';
  // An approved row keeps its status and stamp: the stamp no longer matches, so the
  // approval shows as stale (VIS-04) instead of silently disappearing.
  if (!wasApproved) {
    patch.imageStatus = problems.length > 0 ? 'Needs Brief' : 'Brief Ready';
    if (!loaded.record.formulaFields.includes('imageNextAction')) patch.imageNextAction = problems.length > 0 ? 'Complete the visual brief' : 'Render a revision';
  }
  return write(repo, actor, input, loaded, patch, {
    note: wasApproved ? 'Brief saved. The earlier approval is now stale; render and approve a new revision.' : problems.length > 0 ? 'Saved as a draft brief. It is not complete yet.' : 'Brief saved and ready to render.',
  });
}

/** Uploads already made for an operation, so a retry after a Sheet failure reuses the file (bounded, per process). */
const UPLOADS_KEY = Symbol.for('content-studio.visual-uploads');
const uploadStore = globalThis as unknown as Record<symbol, Map<string, { webLink: string; version: string }> | undefined>;
function uploads(): Map<string, { webLink: string; version: string }> {
  return (uploadStore[UPLOADS_KEY] ??= new Map());
}

export function assetFileName(libraryId: string, version: { revision: number; platform: Platform; language: string }): string {
  return `${libraryId}-SOAR-v1.1-r${String(version.revision).padStart(2, '0')}-${version.platform}-${version.language}.svg`;
}

export async function renderRevision(repo: ContentRepository, drive: DriveGateway, actor: Actor, input: Base): Promise<VisualOutcome> {
  const loaded = await begin(repo, actor, input, { checkRevision: true });
  if (isOutcome(loaded)) {
    // Lost response: this operation already uploaded and recorded its file.
    const prior = uploads().get(`${input.libraryId}:${input.operationId}`);
    if (!loaded.ok && loaded.code === 'STALE_READ' && prior && loaded.current) {
      const fresh = await load(repo, input.libraryId).catch(() => null);
      if (fresh && fresh.record.value.visual.imageFile === prior.webLink && fresh.record.value.visual.version === prior.version) {
        return { ok: true, replayed: true, item: fresh.view, note: `Rendered ${prior.version}. It had already been saved.` };
      }
    }
    return loaded;
  }
  const { view, record } = loaded;
  if (!view.canRender.ok) {
    return blocked(view.canRender.reason, { problems: [...view.briefProblems, ...view.renderProblems], current: view });
  }
  const item = record.value;
  const brief = completeBrief(item)!;
  const platform = view.platform!;
  const language = view.language!;
  const revision = (parseVisualVersion(item.visual.version)?.revision ?? 0) + 1;
  const { svg, problems } = renderBriefSvg(brief, { language, platform, revision });
  if (problems.length > 0) return blocked('Fix the layout problems first.', { problems, current: view });
  const version = formatVisualVersion({ system: 'SOAR-v1.1', revision, platform, language });

  const cache = uploads();
  // Keyed by item and operation so a reused operation id can never attach another item's file.
  const cacheKey = `${item.libraryId}:${input.operationId}`;
  let upload = cache.get(cacheKey);
  if (upload && upload.version !== version) upload = undefined;
  const steps: StepResult[] = [];
  if (!upload) {
    try {
      const created = await drive.createFile({ name: assetFileName(item.libraryId, { revision, platform, language }), mimeType: 'image/svg+xml', bytes: new TextEncoder().encode(svg) });
      upload = { webLink: created.webLink, version };
      cache.set(cacheKey, upload);
      if (cache.size > 200) cache.delete(cache.keys().next().value!);
      steps.push({ step: 'upload asset to Drive', provider: 'drive', status: 'done', revision: created.revision });
    } catch (error) {
      const code = isAppError(error) ? error.code : 'PROVIDER_UNAVAILABLE';
      return { ok: false, code, message: 'The asset could not be uploaded to Drive. Nothing was written to the Sheet.', steps: [{ step: 'upload asset to Drive', provider: 'drive', status: 'failed', errorCode: code }] };
    }
  } else {
    steps.push({ step: 'upload asset to Drive', provider: 'drive', status: 'skipped_already_applied' });
  }

  const patch: LibraryPatch = { imageFile: upload.webLink, visualVersion: version, imageStatus: 'Needs Review' };
  if (!record.formulaFields.includes('imageNextAction')) patch.imageNextAction = formatRenderNote(item.visual.brief, version, upload.webLink);
  const out = await write(repo, actor, input, loaded, patch, { note: `Rendered ${version}. Review it, then approve this exact revision.`, steps });
  if (!out.ok && out.code !== 'STALE_READ' && out.code !== 'CONFLICT') {
    return { ...out, code: 'PARTIAL_FAILURE', message: 'The file was uploaded but the Sheet was not updated. Retry: the same upload is reused.' };
  }
  if (!out.ok) return { ...out, message: 'The file was uploaded but the row changed first, so the Sheet was not updated. Review the latest version and render again.' };
  return out;
}

export async function approveRevision(
  repo: ContentRepository,
  drive: DriveGateway,
  actor: Actor,
  input: Base & { version: string; fileHash: string; material: string },
): Promise<VisualOutcome> {
  const loaded = await begin(repo, actor, input);
  if (isOutcome(loaded)) return loaded;
  const { view, record } = loaded;
  const v = record.value.visual;
  if (v.version !== input.version || view.fileHash !== input.fileHash || view.material !== input.material) {
    return { ok: false, code: 'STALE_READ', message: 'This is no longer the current revision. Nothing was approved; review the current one.', current: view };
  }
  if (record.formulaFields.includes('imageNextAction')) {
    return blocked('Image Next Action holds a formula, so the approval stamp cannot be written. Nothing was approved. Replace the formula with plain text in the Sheet, then approve.', { current: view });
  }
  if (view.approval === 'approved') return { ok: true, replayed: true, item: view, note: `Already approved: ${v.version || view.decisionLabel}.` };
  if (!view.reviewable.ok) return blocked(view.reviewable.reason, { current: view, blockers: view.gates.filter((g) => g.code !== 'VISUAL_NOT_APPROVED') });

  if (view.decision === 'original_graphic') {
    // The approved file must be exactly what the reviewer saw: the deterministic render of this brief and revision.
    const fileId = parseDriveFileId(v.imageFile);
    const parsed = parseVisualVersion(v.version)!;
    const brief = completeBrief(record.value)!;
    if (!fileId) return blocked('Image File is not a Drive file link. Render a new revision.', { current: view });
    let text: string;
    try {
      const { bytes, meta } = await drive.readBytes(fileId, 2 * 1024 * 1024);
      if (meta.mimeType !== 'image/svg+xml') return blocked('This file was not rendered by Content Studio. Render a new revision to review it here.', { current: view });
      text = new TextDecoder().decode(bytes);
    } catch (error) {
      return { ok: false, code: isAppError(error) ? error.code : 'PROVIDER_UNAVAILABLE', message: 'The file could not be read from Drive, so it cannot be checked. Nothing was approved.', current: view };
    }
    const expected = renderBriefSvg(brief, { language: parsed.language, platform: parsed.platform, revision: parsed.revision }).svg;
    if (text !== expected) return blocked('The file in Drive does not match this brief and revision. Nothing was approved; render a new revision.', { current: view });
  }

  const patch: LibraryPatch = { imageStatus: 'Approved', imageNextAction: formatVisualApprovalNote(v) };
  return write(repo, actor, input, loaded, patch, { note: `Approved ${v.version || view.decisionLabel} for ${view.platformLabel}.` });
}

/** Server-side preview render (never Drive bytes): the current revision, or an unversioned draft of the saved brief. */
export async function renderPreview(repo: ContentRepository, libraryId: string, rev: 'current' | 'draft'): Promise<{ svg: string; version: string }> {
  const { record, view } = await load(repo, libraryId);
  const item = record.value;
  if (view.decision !== 'original_graphic') throw new AppError('NOT_FOUND', { reason: 'not_original_graphic' });
  const brief = completeBrief(item);
  if (!brief) throw new AppError('GATE_BLOCKED', { reason: 'brief_incomplete' });
  if (rev === 'current') {
    const parsed = parseVisualVersion(item.visual.version);
    if (!parsed || view.preview === 'none') throw new AppError('NOT_FOUND', { reason: 'no_revision' });
    // Never show a re-render of a newer brief under an older revision's label.
    if (view.preview !== 'current') throw new AppError('CONFLICT', { reason: 'brief_changed_after_render' });
    return { svg: renderBriefSvg(brief, { language: parsed.language, platform: parsed.platform, revision: parsed.revision }).svg, version: formatVisualVersion(parsed) };
  }
  if (!view.platform || !view.language) throw new AppError('GATE_BLOCKED', { reason: 'platform' });
  return { svg: renderBriefSvg(brief, { language: view.language, platform: view.platform, revision: 0 }).svg, version: 'draft' };
}

/** Route dispatcher, so the route stays a thin auth + parse shell. */
export async function runVisualAction(repo: ContentRepository, drive: DriveGateway, actor: Actor, action: VisualAction): Promise<VisualOutcome> {
  switch (action.action) {
    case 'decide':
      return decideVisual(repo, actor, action);
    case 'brief':
      return saveBrief(repo, actor, action);
    case 'render':
      return renderRevision(repo, drive, actor, action);
    case 'approve':
      return approveRevision(repo, drive, actor, action);
    case 'check_screenshot':
      return checkScreenshot(repo, action.libraryId, action.screenshotId);
  }
}
