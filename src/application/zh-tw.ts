import 'server-only';
import { CONTENT_STAGES } from '@/domain/enums';
import { isAppError, type ErrorCode } from '@/domain/errors';
import { fingerprint } from '@/domain/hash';
import type { SchedulePatch } from '@/domain/mapping';
import { lineageLibraryId } from './ready';
import { parseZhStamp } from '@/domain/stage';
import { contentIdSchema, libraryIdSchema, operationIdSchema, revisionSchema, type Actor, type MutationResult } from '@/domain/mutation';
import type { LibraryItem, ScheduledPost, ScheduleRecord } from '@/domain/records';
import { approvalState, formatZhStamp } from '@/domain/stage';
import { adaptationState, resolveThreadsRow, withZhStamp, type ThreadsCandidate } from '@/domain/zh-state';
import { simplifiedCharsIn, ZH_GLOSSARY, zhAdaptationOutputSchema, zhProblems, type ZhAdaptationOutput } from '@/domain/zh-terms';
import type { ZhAdaptationState } from '@/domain/gates';
import { emit, targetHash } from '@/observability/events';
import { SECURITY_RULES, wrapUntrusted } from './ai-prompt';
import type { AiGateway, AiMeta, AiTask, ContentRepository } from './ports';

/**
 * X to Threads zh-TW adaptation (CS-011 ZHTW-01..05).
 *
 * Only final X copy at `EN Approved` or later is eligible. Generation writes
 * nothing. Saving writes the Threads row only (never the X row), stamps the lineage
 * `[cs:zh-src:<X id>:<hash>]` over the exact X hook and content it was made from,
 * and refuses if the X row changed meanwhile, so a late result is discarded.
 * Freshness is derived from that stamp on every read (src/domain/zh-state.ts).
 */
export type ZhInput = { hook: string; content: string };

export const ZH_TW_TASK: AiTask<ZhAdaptationOutput, ZhInput> = {
  name: 'zh_tw',
  promptVersion: 'zh_tw.v1',
  maxOutputTokens: 12_000,
  system: [
    'You adapt approved English X posts into natural Taiwan Traditional Chinese (zh-TW) for Threads.',
    'Adapt, do not translate literally: keep the meaning and the author\'s calm, specific voice, and avoid calques.',
    'Use Traditional characters and Taiwan usage only; never Simplified characters or Mainland terms.',
    'Keep the paragraph structure and line breaks of the source.',
    `Pinned terminology (English -> zh-TW): ${ZH_GLOSSARY.map((t) => `${t.en} -> ${t.zh}`).join('; ')}.`,
    'Return hook (the adapted opening line), content (the full adapted post, starting with that hook), terminologyNotes, and a Chinese QA self-check with pass or check for meaning, naturalness, terminology, lineBreaks and taiwanUsage, plus short notes. A self-check is advisory: a human approves.',
    SECURITY_RULES,
  ].join('\n'),
  render: (input) => ['Adapt this approved X post.', wrapUntrusted('source_hook', input.hook), wrapUntrusted('source_text', input.content)].join('\n'),
  schema: zhAdaptationOutputSchema,
  validate: (value, input) => zhProblems(value, input),
};

const EN_APPROVED_INDEX = CONTENT_STAGES.indexOf('EN Approved');

export type EligibilityReason =
  | 'not_x'
  | 'stage_unrecognised'
  | 'not_en_approved'
  | 'missing_hook'
  | 'missing_content'
  | 'library_approval_not_current';

/** ZHTW-01: only final, approved X copy can be adapted. */
export function checkEligibility(x: ScheduledPost, library?: LibraryItem | null): { ok: true } | { ok: false; reason: EligibilityReason } {
  if (!(x.platform?.ok && x.platform.value === 'X')) return { ok: false, reason: 'not_x' };
  if (!x.contentStage || !x.contentStage.ok) return { ok: false, reason: 'stage_unrecognised' };
  if (CONTENT_STAGES.indexOf(x.contentStage.value) < EN_APPROVED_INDEX) return { ok: false, reason: 'not_en_approved' };
  if (x.hook.trim() === '') return { ok: false, reason: 'missing_hook' };
  if (x.content.trim() === '') return { ok: false, reason: 'missing_content' };
  if (library && approvalState(library) !== 'approved') return { ok: false, reason: 'library_approval_not_current' };
  return { ok: true };
}

export type ZhProposal = ZhAdaptationOutput & {
  id: string;
  sourceContentId: string;
  sourceRevision: string;
  /** Exact X copy the adaptation was made from; saving re-checks it. */
  sourceHook: string;
  sourceContent: string;
  sourceStamp: string;
  threadsContentId: string;
  threadsRevision: string;
  meta: AiMeta;
};

export type ZhGeneration =
  | { ok: true; proposal: ZhProposal }
  | { ok: false; code: ErrorCode; reason?: string; candidates?: ThreadsCandidate[]; meta?: AiMeta };

type Located = { ok: true; x: ScheduleRecord; all: ScheduleRecord[] } | { ok: false; code: ErrorCode; reason?: string };
type Linked = { ok: true; th: ScheduleRecord } | { ok: false; code: ErrorCode; reason?: string; candidates?: ThreadsCandidate[] };

async function locate(repo: ContentRepository, sourceContentId: string): Promise<Located> {
  let all: ScheduleRecord[];
  try {
    all = await repo.listSchedule();
  } catch (error) {
    return { ok: false, code: isAppError(error) ? error.code : 'PROVIDER_UNAVAILABLE' };
  }
  const xs = all.filter((r) => r.value.contentId === sourceContentId);
  if (xs.length === 0) return { ok: false, code: 'NOT_FOUND', reason: 'source_not_found' };
  if (xs.length > 1) return { ok: false, code: 'CONFLICT', reason: 'duplicate_id' };
  return { ok: true, x: xs[0]!, all };
}

/** ZHTW-03: the one Threads row for this X row, or a typed reason. */
function linkThreads(x: ScheduleRecord, all: ScheduleRecord[]): Linked {
  const resolved = resolveThreadsRow(x.value.contentId, all.map((r) => r.value));
  if (resolved.kind === 'none') return { ok: false, code: 'NOT_FOUND', reason: 'no_threads_row' };
  if (resolved.kind === 'ambiguous') return { ok: false, code: 'AMBIGUOUS_MATCH', reason: 'threads_rows', candidates: resolved.candidates };
  return { ok: true, th: all.find((r) => r.value === resolved.post)! };
}

async function libraryFor(repo: ContentRepository, libraryId?: string): Promise<LibraryItem | null | 'error'> {
  if (!libraryId) return null;
  if (!libraryIdSchema.safeParse(libraryId).success) return 'error';
  try {
    return (await repo.getLibrary(libraryId)).value;
  } catch {
    return 'error';
  }
}

export async function generateAdaptation(args: {
  ai: AiGateway;
  repo: ContentRepository;
  sourceContentId: string;
  /** Library row the X copy came from, when linked; its approval must be current. */
  libraryId?: string;
  signal?: AbortSignal;
}): Promise<ZhGeneration> {
  if (!contentIdSchema.safeParse(args.sourceContentId).success) return { ok: false, code: 'VALIDATION_FAILED' };
  const found = await locate(args.repo, args.sourceContentId);
  if (!found.ok) return found;
  const x = found.x.value;
  // The Library row comes from the promotion lineage (#lib=) when not given explicitly.
  const library = await libraryFor(args.repo, args.libraryId ?? lineageLibraryId(x.sourceLink) ?? undefined);
  if (library === 'error') return { ok: false, code: 'NOT_FOUND', reason: 'library_not_found' };
  const eligible = checkEligibility(x, library);
  if (!eligible.ok) return { ok: false, code: 'GATE_BLOCKED', reason: eligible.reason };
  if (x.hook.length > 2000 || x.content.length > 30_000) return { ok: false, code: 'VALIDATION_FAILED' };
  const linked = linkThreads(found.x, found.all);
  if (!linked.ok) return linked;

  const result = await args.ai.run(ZH_TW_TASK, { hook: x.hook, content: x.content }, args.signal ? { signal: args.signal } : {});
  if (!result.ok) return { ok: false, code: result.code, meta: result.meta };
  const stamp = formatZhStamp(x.contentId, x.hook, x.content);
  return {
    ok: true,
    proposal: {
      ...result.value,
      id: `zh_${fingerprint(JSON.stringify([x.contentId, stamp, ZH_TW_TASK.promptVersion, result.value.hook, result.value.content]))}`,
      sourceContentId: x.contentId,
      sourceRevision: found.x.revision,
      sourceHook: x.hook,
      sourceContent: x.content,
      sourceStamp: stamp,
      threadsContentId: linked.th.value.contentId,
      threadsRevision: linked.th.revision,
      meta: result.meta,
    },
  };
}

// ------------------------------------------------------------------ writes

export type SaveAdaptationInput = {
  operationId: string;
  threadsContentId: string;
  expectedRevision: string;
  sourceContentId: string;
  sourceHook: string;
  sourceContent: string;
  /** Adapted (possibly hand-edited) zh-TW copy. */
  hook: string;
  content: string;
  libraryId?: string;
  /** Explicit consent to fill an unlinked Threads row that already holds copy. */
  confirmTakeover?: boolean;
};

function report(name: string, op: string, id: string, r: MutationResult<unknown>): void {
  emit({
    name,
    adapter: 'app',
    outcome: r.ok ? (r.replayed ? 'replayed' : 'ok') : r.code === 'STALE_READ' || r.code === 'CONFLICT' ? 'conflict' : r.code === 'GATE_BLOCKED' ? 'blocked' : 'error',
    ...(operationIdSchema.safeParse(op).success ? { operationId: op } : {}),
    targetHash: targetHash(id),
    ...(r.ok ? {} : { code: r.code }),
  });
}

export async function saveAdaptation(repo: ContentRepository, actor: Actor, input: SaveAdaptationInput): Promise<MutationResult<ScheduleRecord>> {
  const op = input.operationId;
  const fail = (code: ErrorCode, details?: Record<string, unknown>): MutationResult<ScheduleRecord> => {
    const r: MutationResult<ScheduleRecord> = { ok: false, operationId: op, code, steps: [], ...(details ? { details } : {}) };
    report('zh.save', op, input.threadsContentId, r);
    return r;
  };
  if (actor.role !== 'owner') return fail('FORBIDDEN');
  if (
    !operationIdSchema.safeParse(op).success ||
    !contentIdSchema.safeParse(input.threadsContentId).success ||
    !contentIdSchema.safeParse(input.sourceContentId).success ||
    !revisionSchema.safeParse(input.expectedRevision).success
  ) {
    return fail('VALIDATION_FAILED', { reason: 'invalid_input' });
  }
  const hook = typeof input.hook === 'string' ? input.hook : '';
  const content = typeof input.content === 'string' ? input.content : '';
  if (hook.trim() === '' || content.trim() === '' || hook.length > 2000 || content.length > 30_000) return fail('VALIDATION_FAILED', { reason: 'copy_length' });
  if (simplifiedCharsIn(hook + content).length > 0) return fail('VALIDATION_FAILED', { reason: 'simplified_characters' });

  // Re-read the X source: a result made from older X copy is discarded (ZHTW-04).
  const found = await locate(repo, input.sourceContentId);
  if (!found.ok) return fail(found.code, { reason: found.reason });
  const x = found.x.value;
  if (x.hook !== input.sourceHook || x.content !== input.sourceContent) return fail('STALE_READ', { reason: 'source_changed' });
  const library = await libraryFor(repo, input.libraryId ?? lineageLibraryId(x.sourceLink) ?? undefined);
  if (library === 'error') return fail('NOT_FOUND', { reason: 'library_not_found' });
  const eligible = checkEligibility(x, library);
  if (!eligible.ok) return fail('GATE_BLOCKED', { reason: eligible.reason });
  const linked = linkThreads(found.x, found.all);
  if (!linked.ok) return fail(linked.code, { reason: linked.reason, ...(linked.candidates ? { candidates: linked.candidates } : {}) });
  const th = linked.th;
  if (th.value.contentId !== input.threadsContentId) return fail('CONFLICT', { reason: 'threads_row_mismatch', resolved: th.value.contentId });
  if (th.value.parentContentId && th.value.parentContentId !== x.contentId) return fail('CONFLICT', { reason: 'parent_mismatch' });
  // Never overwrite a Threads row that is already sent, scheduled or published (review finding 3).
  const t = th.value;
  const inUse =
    t.posted === true ||
    !t.typefullyStatus.ok ||
    t.typefullyStatus.value !== 'Not Sent' ||
    t.typefullyDraftId.trim() !== '' ||
    t.postLink.trim() !== '';
  if (inUse) return fail('GATE_BLOCKED', { reason: 'threads_row_in_use' });
  // A row found only by naming convention that already holds unrelated copy needs an explicit takeover.
  const holdsCopy = t.hook.trim() !== '' || t.chineseContent.trim() !== '';
  if (!t.parentContentId && holdsCopy && !parseZhStamp(t.aiAction) && input.confirmTakeover !== true) {
    return fail('CONFLICT', { reason: 'takeover_needs_confirmation' });
  }

  const patch: SchedulePatch = {
    hook,
    chineseContent: content,
    contentStage: 'ZH Review',
    parentContentId: x.contentId,
    aiAction: withZhStamp(th.value.aiAction, formatZhStamp(x.contentId, x.hook, x.content)),
  };
  // New Chinese copy invalidates an approved image made for the old copy (ZHTW-04).
  const v = th.value.visual;
  if (v.imageStatus.ok && v.imageStatus.value === 'Approved' && v.source.kind !== 'text_only' && th.value.chineseContent !== content) {
    patch.imageStatus = 'Needs Review';
  }
  const result = await repo.updateSchedule({
    operationId: op,
    actor,
    target: { contentId: input.threadsContentId },
    expectedRevision: input.expectedRevision,
    patch,
  });
  report('zh.save', op, input.threadsContentId, result);
  return result;
}

/** Current adaptation state for an X row, for the UI and the Ready gate. */
export async function loadAdaptationState(repo: ContentRepository, sourceContentId: string): Promise<{ ok: true; state: ZhAdaptationState } | { ok: false; code: ErrorCode }> {
  try {
    const all = await repo.listSchedule();
    const x = all.find((r) => r.value.contentId === sourceContentId);
    if (!x) return { ok: false, code: 'NOT_FOUND' };
    return { ok: true, state: adaptationState(x.value, all.map((r) => r.value)) };
  } catch (error) {
    return { ok: false, code: isAppError(error) ? error.code : 'PROVIDER_UNAVAILABLE' };
  }
}

/** ZHTW-05: explicit Chinese QA approval, only for a fresh adaptation awaiting review. */
export async function approveAdaptation(
  repo: ContentRepository,
  actor: Actor,
  input: { operationId: string; threadsContentId: string; expectedRevision: string },
): Promise<MutationResult<ScheduleRecord>> {
  const op = input.operationId;
  const fail = (code: ErrorCode, details?: Record<string, unknown>): MutationResult<ScheduleRecord> => {
    const r: MutationResult<ScheduleRecord> = { ok: false, operationId: op, code, steps: [], ...(details ? { details } : {}) };
    report('zh.approve', op, input.threadsContentId, r);
    return r;
  };
  if (actor.role !== 'owner') return fail('FORBIDDEN');
  if (!operationIdSchema.safeParse(op).success || !contentIdSchema.safeParse(input.threadsContentId).success || !revisionSchema.safeParse(input.expectedRevision).success) {
    return fail('VALIDATION_FAILED', { reason: 'invalid_input' });
  }
  let all: ScheduleRecord[];
  try {
    all = await repo.listSchedule();
  } catch (error) {
    return fail(isAppError(error) ? error.code : 'PROVIDER_UNAVAILABLE');
  }
  const th = all.filter((r) => r.value.contentId === input.threadsContentId);
  if (th.length !== 1) return fail(th.length === 0 ? 'NOT_FOUND' : 'CONFLICT');
  const thRec = th[0]!;
  if (thRec.revision !== input.expectedRevision) return fail('STALE_READ', { currentRevision: thRec.revision });
  const parentId = thRec.value.parentContentId;
  const x = all.find((r) => r.value.contentId === parentId && r.value.platform?.ok && r.value.platform.value === 'X');
  if (!x) return fail('GATE_BLOCKED', { reason: 'no_parent' });
  const resolved = resolveThreadsRow(x.value.contentId, all.map((r) => r.value));
  if (resolved.kind !== 'found' || resolved.post.contentId !== input.threadsContentId) return fail('GATE_BLOCKED', { state: 'ambiguous' });
  const state = adaptationState(x.value, all.map((r) => r.value));
  if (state !== 'awaiting_review') return fail('GATE_BLOCKED', { state });
  // The X parent must still be eligible, including its Library approval (review finding 4).
  const library = await libraryFor(repo, lineageLibraryId(x.value.sourceLink) ?? undefined);
  if (library === 'error') return fail('NOT_FOUND', { reason: 'library_not_found' });
  const eligible = checkEligibility(x.value, library);
  if (!eligible.ok) return fail('GATE_BLOCKED', { reason: eligible.reason });
  const result = await repo.updateSchedule({
    operationId: op,
    actor,
    target: { contentId: input.threadsContentId },
    expectedRevision: input.expectedRevision,
    patch: { contentStage: 'Ready' },
  });
  report('zh.approve', op, input.threadsContentId, result);
  return result;
}
