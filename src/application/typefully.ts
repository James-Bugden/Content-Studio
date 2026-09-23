import 'server-only';
import type { Platform, TypefullyStatus } from '@/domain/enums';
import { AppError, toAppError, type ErrorCode } from '@/domain/errors';
import { fingerprint } from '@/domain/hash';
import type { SchedulePatch } from '@/domain/mapping';
import { contentIdSchema, operationIdSchema, revisionSchema, type Actor, type MutationResult, type StepResult } from '@/domain/mutation';
import type { ScheduledPost, ScheduleRecord, WorkflowSettings } from '@/domain/records';
import { SCHEDULE_SYNC_FIELDS, type ScheduleField } from '@/domain/sheet-schema';
import { EXACT_MATCH_SIMILARITY, textSimilarity } from '@/domain/similarity';
import {
  CANDIDATE_WINDOW_MINUTES,
  TIME_MATCH_MINUTES,
  contentIdDate,
  finalTextHash,
  formatSyncStamp,
  minutesBetween,
  parseSyncStamp,
  plannedTaipeiIso,
  sameInstant,
  taipeiParts,
  toTaipeiIso,
  workingCopy,
} from '@/domain/typefully';
import { adaptationState } from '@/domain/zh-state';
import { emit, targetHash, type TelemetryEvent } from '@/observability/events';
import type { ContentRepository, TypefullyDraft, TypefullyGateway, TypefullyMetricKey } from './ports';

/**
 * Typefully reconciliation, idempotent create and exact final-copy sync (CS-015),
 * plus publication and analytics sync (CS-016).
 *
 * - Reconciliation states are distinct (TYPE-01): linked, single match, ambiguous,
 *   no match, provider error. Ambiguity never links or creates (TYPE-03).
 * - Create is guarded against duplicates (TYPE-02): an in-process lock per
 *   operation, a lookup by the operation's idempotency marker, then a candidate
 *   search; a lost create response is recovered by lookup, never by a blind create.
 * - Sync is directional and conflict-checked (TYPE-04/05, PUB-03/04). The sync
 *   baseline is the hash stamped in `Final Synced From Typefully`.
 * - Every provider call and every service outcome emits one redacted event:
 *   no copy, no draft ids, only a target hash (OBS-04).
 */
export type TypefullyServiceOptions = { now?: () => Date };

const DRAFT_ID = /^[A-Za-z0-9_-]{1,64}$/;

// ------------------------------------------------------------------ telemetry

async function call<T>(op: string, contentId: string, fn: () => Promise<T>, operationId?: string): Promise<T> {
  const started = performance.now();
  const base = { name: `typefully.call.${op}`, adapter: 'typefully' as const, targetHash: targetHash(contentId), ...(operationId ? { operationId } : {}) };
  try {
    const value = await fn();
    emit({ ...base, outcome: 'ok', latencyMs: performance.now() - started, facts: { rateLimited: false } });
    return value;
  } catch (error) {
    const e = toAppError(error);
    const retryAfter = typeof e.details.retryAfterSeconds === 'number' ? e.details.retryAfterSeconds : undefined;
    const status = typeof e.details.httpStatus === 'number' ? e.details.httpStatus : undefined;
    emit({
      ...base,
      outcome: e.code === 'CONFLICT' ? 'conflict' : 'error',
      code: e.code,
      latencyMs: performance.now() - started,
      ...(status !== undefined ? { httpStatus: status } : {}),
      facts: { rateLimited: e.code === 'RATE_LIMITED', ...(retryAfter !== undefined ? { retryAfterS: retryAfter } : {}) },
    });
    throw e;
  }
}

function outcome(name: string, contentId: string, result: TelemetryEvent['outcome'], facts: TelemetryEvent['facts'], extra: { code?: ErrorCode; operationId?: string } = {}): void {
  emit({ name: `typefully.${name}`, adapter: 'typefully', outcome: result, targetHash: targetHash(contentId), ...(facts ? { facts } : {}), ...extra });
}

// ------------------------------------------------------------------ shared reads

function platformOf(post: ScheduledPost): Platform | null {
  return post.platform?.ok ? post.platform.value : null;
}

function viewText(draft: TypefullyDraft, platform: Platform): string | null {
  return draft.perPlatform[platform]?.text ?? (draft.platform === platform ? draft.text : null);
}

type Loaded = { schedule: ScheduleRecord[]; record: ScheduleRecord };

async function loadRow(repo: ContentRepository, contentId: string): Promise<Loaded> {
  const schedule = await repo.listSchedule();
  const found = schedule.filter((r) => r.value.contentId === contentId);
  if (found.length === 0) throw new AppError('NOT_FOUND');
  if (found.length > 1) throw new AppError('CONFLICT', { reason: 'duplicate_id' });
  return { schedule, record: found[0]! };
}

// ------------------------------------------------------------------ comparison

export type CopyComparison = {
  platform: Platform;
  /** Sheet working copy: `Content`, or `Chinese Content` for Threads. */
  sheetWorking: string;
  sheetFinal: string;
  typefully: string;
  /** Sheet `Final Content` already equals Typefully's text exactly. */
  identical: boolean;
  lastSyncAt: string | null;
  typefullyUpdatedAt: string;
  /** Null when there is no sync baseline to compare with. */
  typefullyEditedSinceSync: boolean | null;
  sheetFinalEditedSinceSync: boolean | null;
  newer: 'typefully' | 'sheet' | 'both' | 'same' | 'unknown';
};

export function compareCopy(row: ScheduledPost, draft: TypefullyDraft): CopyComparison {
  const platform = platformOf(row) ?? draft.platform;
  const typefully = viewText(draft, platform) ?? '';
  const sheetFinal = row.finalContent;
  const stamp = parseSyncStamp(row.finalSyncedAt);
  const identical = sheetFinal === typefully;
  let tfEdited: boolean | null = null;
  let sheetEdited: boolean | null = null;
  if (stamp) {
    tfEdited = stamp.textHash ? finalTextHash(typefully) !== stamp.textHash : Date.parse(draft.updatedAt) > Date.parse(stamp.at);
    if (stamp.textHash) sheetEdited = finalTextHash(sheetFinal) !== stamp.textHash;
  }
  let newer: CopyComparison['newer'];
  if (identical) newer = 'same';
  else if (tfEdited && sheetEdited) newer = 'both';
  else if (tfEdited && sheetEdited === false) newer = 'typefully';
  else if (sheetEdited && tfEdited === false) newer = 'sheet';
  else if (tfEdited === true && sheetEdited === null) newer = 'typefully';
  else newer = 'unknown';
  return {
    platform,
    sheetWorking: workingCopy(row, platform),
    sheetFinal,
    typefully,
    identical,
    lastSyncAt: stamp?.at ?? null,
    typefullyUpdatedAt: draft.updatedAt,
    typefullyEditedSinceSync: tfEdited,
    sheetFinalEditedSinceSync: sheetEdited,
    newer,
  };
}

// ------------------------------------------------------------------ reconcile (TYPE-01, TYPE-03)

export type RowDiscriminators = { contentId: string; platform: Platform; date: string | null; slot: string; plannedAt: string | null };

export type CandidateDiscriminators = {
  draftId: string;
  platform: Platform;
  platforms: Platform[];
  status: TypefullyStatus;
  /** Taipei date and time of the draft's scheduled or planned instant. */
  date: string | null;
  time: string | null;
  /** Slot whose Workflow Settings time equals the draft time, when one does. */
  slot: string | null;
  deltaMinutes: number | null;
  similarity: number;
  timeMatch: boolean;
  multiPlatform: boolean;
  /** Another Schedule row already holds this draft id. */
  linkedToContentId: string | null;
  exact: boolean;
};

export type ReconcileCandidate = { draft: TypefullyDraft; discriminators: CandidateDiscriminators };

export type Reconciliation =
  | { kind: 'linked'; draft: TypefullyDraft; comparison: CopyComparison; platformMismatch: boolean }
  | { kind: 'single_match'; row: RowDiscriminators; candidate: ReconcileCandidate; discriminators: CandidateDiscriminators }
  | { kind: 'ambiguous'; row: RowDiscriminators; candidates: ReconcileCandidate[]; discriminators: CandidateDiscriminators[] }
  | { kind: 'no_match'; row: RowDiscriminators; searched: boolean }
  | { kind: 'invalid_row'; reason: 'platform_unrecognised' }
  | { kind: 'provider_error'; provider: 'sheet' | 'typefully'; code: ErrorCode };

async function candidateSearch(
  tf: TypefullyGateway,
  row: ScheduledPost,
  platform: Platform,
  schedule: readonly ScheduleRecord[],
  settings: WorkflowSettings | null,
  operationId?: string,
): Promise<Exclude<Reconciliation, { kind: 'linked' } | { kind: 'invalid_row' } | { kind: 'provider_error' }>> {
  const plannedAt = plannedTaipeiIso(row);
  const date = contentIdDate(row.contentId);
  const rowDisc: RowDiscriminators = { contentId: row.contentId, platform, date, slot: row.slot, plannedAt };
  let from: string;
  let to: string;
  if (plannedAt) {
    const at = Date.parse(plannedAt);
    from = new Date(at - CANDIDATE_WINDOW_MINUTES * 60_000).toISOString();
    to = new Date(at + CANDIDATE_WINDOW_MINUTES * 60_000).toISOString();
  } else if (date) {
    from = new Date(Date.parse(`${date}T00:00:00+08:00`)).toISOString();
    to = new Date(Date.parse(`${date}T23:59:59+08:00`)).toISOString();
  } else {
    return { kind: 'no_match', row: rowDisc, searched: false };
  }
  const drafts = await call('list_drafts', row.contentId, () => tf.listDrafts({ platform, from, to }), operationId);
  const sheetTexts = [workingCopy(row, platform), row.finalContent].filter((t) => t.trim() !== '');
  const candidates: ReconcileCandidate[] = drafts.map((draft) => {
    const text = viewText(draft, platform) ?? '';
    const similarity = sheetTexts.length ? Math.max(...sheetTexts.map((t) => textSimilarity(t, text))) : 0;
    const parts = draft.scheduledAt ? taipeiParts(draft.scheduledAt) : null;
    const deltaMinutes = plannedAt && draft.scheduledAt ? minutesBetween(plannedAt, draft.scheduledAt) : null;
    const timeMatch = deltaMinutes !== null && deltaMinutes <= TIME_MATCH_MINUTES;
    const linked = schedule.find((r) => r.value.typefullyDraftId === draft.id && r.value.contentId !== row.contentId);
    const slot = parts && settings ? (settings.slots.find((s) => s.platform === platform && s.time === parts.time)?.slot ?? null) : null;
    const multiPlatform = draft.platforms.length > 1;
    const disc: CandidateDiscriminators = {
      draftId: draft.id,
      platform,
      platforms: draft.platforms,
      status: draft.status,
      date: parts?.date ?? null,
      time: parts?.time ?? null,
      slot,
      deltaMinutes,
      similarity,
      timeMatch,
      multiPlatform,
      linkedToContentId: linked?.value.contentId ?? null,
      exact: similarity >= EXACT_MATCH_SIMILARITY && timeMatch && !multiPlatform && !linked,
    };
    return { draft, discriminators: disc };
  });
  candidates.sort((a, b) => b.discriminators.similarity - a.discriminators.similarity || a.draft.id.localeCompare(b.draft.id));
  if (candidates.length === 0) return { kind: 'no_match', row: rowDisc, searched: true };
  if (candidates.length === 1 && candidates[0]!.discriminators.exact) {
    return { kind: 'single_match', row: rowDisc, candidate: candidates[0]!, discriminators: candidates[0]!.discriminators };
  }
  return { kind: 'ambiguous', row: rowDisc, candidates, discriminators: candidates.map((c) => c.discriminators) };
}

async function reconcileLoaded(
  repo: ContentRepository,
  tf: TypefullyGateway,
  loaded: Loaded,
  operationId?: string,
): Promise<Reconciliation> {
  const row = loaded.record.value;
  const platform = platformOf(row);
  if (!platform) return { kind: 'invalid_row', reason: 'platform_unrecognised' };
  try {
    if (row.typefullyDraftId) {
      const draft = await call('get_draft', row.contentId, () => tf.getDraft(row.typefullyDraftId), operationId);
      return { kind: 'linked', draft, comparison: compareCopy(row, draft), platformMismatch: !draft.platforms.includes(platform) };
    }
    let settings: WorkflowSettings | null = null;
    try {
      settings = await repo.workflowSettings();
    } catch {
      settings = null;
    }
    return await candidateSearch(tf, row, platform, loaded.schedule, settings, operationId);
  } catch (error) {
    return { kind: 'provider_error', provider: 'typefully', code: toAppError(error).code };
  }
}

export async function reconcile(repo: ContentRepository, tf: TypefullyGateway, contentId: string): Promise<Reconciliation> {
  let result: Reconciliation;
  try {
    result = await reconcileLoaded(repo, tf, await loadRow(repo, contentId));
  } catch (error) {
    result = { kind: 'provider_error', provider: 'sheet', code: toAppError(error).code };
  }
  outcome('reconcile', contentId, result.kind === 'provider_error' ? 'error' : result.kind === 'ambiguous' ? 'blocked' : 'ok', {
    kind: result.kind,
    ...(result.kind === 'ambiguous' ? { candidates: result.candidates.length } : {}),
    ...(result.kind === 'provider_error' ? { provider: result.provider } : {}),
  }, result.kind === 'provider_error' ? { code: result.code } : {});
  return result;
}

// ------------------------------------------------------------------ mutation plumbing

type Input = { operationId: string; contentId: string; expectedRevision: string };

function validInput(i: Input): boolean {
  return operationIdSchema.safeParse(i.operationId).success && contentIdSchema.safeParse(i.contentId).success && revisionSchema.safeParse(i.expectedRevision).success;
}

class Run<T> {
  readonly steps: StepResult[] = [];
  constructor(
    private readonly name: string,
    private readonly input: Input,
  ) {}
  step(step: string, provider: StepResult['provider'], status: StepResult['status'], extra: Partial<StepResult> = {}): void {
    this.steps.push({ step, provider, status, ...extra });
  }
  fail(code: ErrorCode, details?: Record<string, unknown>, facts: Record<string, string | number | boolean> = {}): MutationResult<T> {
    outcome(this.name, this.input.contentId, code === 'CONFLICT' || code === 'STALE_READ' || code === 'AMBIGUOUS_MATCH' ? 'conflict' : code === 'GATE_BLOCKED' ? 'blocked' : code === 'PARTIAL_FAILURE' ? 'partial' : 'error', { ...facts, ...(typeof details?.reason === 'string' ? { reason: details.reason } : {}) }, { code, operationId: this.input.operationId });
    return { ok: false, operationId: this.input.operationId, code, steps: this.steps, ...(details ? { details } : {}) };
  }
  ok(value: T, replayed: boolean, facts: Record<string, string | number | boolean> = {}): MutationResult<T> {
    outcome(this.name, this.input.contentId, replayed ? 'replayed' : 'ok', facts, { operationId: this.input.operationId });
    return { ok: true, operationId: this.input.operationId, replayed, value, steps: this.steps };
  }
}

function assertSyncFields(patch: SchedulePatch): void {
  for (const field of Object.keys(patch) as ScheduleField[]) {
    if (!SCHEDULE_SYNC_FIELDS.includes(field) && field !== 'typefullyDraftId') throw new AppError('VALIDATION_FAILED', { reason: 'field_not_syncable', field });
  }
}

async function writeRow<T>(
  run: Run<T>,
  repo: ContentRepository,
  actor: Actor,
  input: Input,
  patch: SchedulePatch,
  stepName: string,
): Promise<{ ok: true; record: ScheduleRecord; replayed: boolean } | { ok: false; code: ErrorCode; details?: Record<string, unknown> }> {
  assertSyncFields(patch);
  const res = await repo.updateSchedule({ operationId: input.operationId, actor, target: { contentId: input.contentId }, expectedRevision: input.expectedRevision, patch });
  const sheetStep = res.steps.find((s) => s.provider === 'sheet');
  if (!res.ok) {
    run.step(stepName, 'sheet', 'failed', { errorCode: res.code });
    return { ok: false, code: res.code, ...(res.details ? { details: res.details } : {}) };
  }
  run.step(stepName, 'sheet', sheetStep?.status ?? 'done', { revision: res.value.revision });
  return { ok: true, record: res.value, replayed: res.replayed };
}

export type LinkResult = { record: ScheduleRecord; draft: TypefullyDraft };

// ------------------------------------------------------------------ link

export async function linkDraft(
  repo: ContentRepository,
  tf: TypefullyGateway,
  actor: Actor,
  input: Input & { draftId: string },
): Promise<MutationResult<LinkResult>> {
  const run = new Run<LinkResult>('link', input);
  if (actor.role !== 'owner') return run.fail('FORBIDDEN');
  if (!validInput(input) || !DRAFT_ID.test(input.draftId)) return run.fail('VALIDATION_FAILED', { reason: 'invalid_input' });
  let loaded: Loaded;
  try {
    loaded = await loadRow(repo, input.contentId);
  } catch (error) {
    return run.fail(toAppError(error).code);
  }
  const row = loaded.record.value;
  const platform = platformOf(row);
  if (!platform) return run.fail('VALIDATION_FAILED', { reason: 'platform_unrecognised' });
  if (row.typefullyDraftId && row.typefullyDraftId !== input.draftId) return run.fail('CONFLICT', { reason: 'already_linked' });
  const elsewhere = loaded.schedule.find((r) => r.value.typefullyDraftId === input.draftId && r.value.contentId !== input.contentId);
  if (elsewhere) return run.fail('CONFLICT', { reason: 'linked_elsewhere', contentId: elsewhere.value.contentId });
  let draft: TypefullyDraft;
  try {
    draft = await call('get_draft', input.contentId, () => tf.getDraft(input.draftId), input.operationId);
    run.step('fetch Typefully draft', 'typefully', 'done');
  } catch (error) {
    run.step('fetch Typefully draft', 'typefully', 'failed', { errorCode: toAppError(error).code });
    return run.fail(toAppError(error).code);
  }
  if (!draft.platforms.includes(platform)) return run.fail('CONFLICT', { reason: 'platform_mismatch' });
  if (draft.platforms.length > 1) return run.fail('CONFLICT', { reason: 'multi_platform_draft' });
  const w = await writeRow(run, repo, actor, input, { typefullyDraftId: draft.id, typefullyStatus: draft.status }, 'link Schedule row');
  if (!w.ok) return run.fail(w.code, w.details);
  return run.ok({ record: w.record, draft }, w.replayed);
}

// ------------------------------------------------------------------ create (TYPE-02)

/** Stable per operation and row; never derived from content text. */
export function createIdempotencyKey(operationId: string, contentId: string): string {
  return `cs${fingerprint(`typefully-create:${operationId}:${contentId}`)}`;
}

export type CreateGate =
  | 'platform_unrecognised'
  | 'stage_not_ready'
  | 'missing_copy'
  | 'no_planned_date'
  | 'zh_adaptation_not_approved';

function createGate(record: ScheduleRecord, schedule: readonly ScheduleRecord[]): { ok: true; platform: Platform; text: string } | { ok: false; reason: CreateGate; state?: string } {
  const row = record.value;
  const platform = platformOf(row);
  if (!platform) return { ok: false, reason: 'platform_unrecognised' };
  if (!(row.contentStage?.ok && row.contentStage.value === 'Ready')) return { ok: false, reason: 'stage_not_ready' };
  if (platform === 'Threads') {
    const parentId = row.parentContentId || row.contentId.replace(/-TH$/, '-X');
    const parent = schedule.find((r) => r.value.contentId === parentId);
    const state = parent ? adaptationState(parent.value, schedule.map((r) => r.value)) : 'missing';
    if (state !== 'approved') return { ok: false, reason: 'zh_adaptation_not_approved', state };
  }
  const text = workingCopy(row, platform);
  if (text.trim() === '') return { ok: false, reason: 'missing_copy' };
  return { ok: true, platform, text };
}

const inflight = new Map<string, Promise<MutationResult<LinkResult>>>();

export async function createDraft(
  repo: ContentRepository,
  tf: TypefullyGateway,
  actor: Actor,
  input: Input & { timing?: 'plan' | 'publish' | 'none' },
  options: TypefullyServiceOptions = {},
): Promise<MutationResult<LinkResult>> {
  // Double click in one server instance: the second call shares the first call's outcome.
  const lockKey = `${input.operationId}:${input.contentId}`;
  const running = inflight.get(lockKey);
  if (running) {
    const shared = await running;
    return shared.ok ? { ...shared, replayed: true } : shared;
  }
  const promise = createDraftOnce(repo, tf, actor, input, options);
  inflight.set(lockKey, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(lockKey);
  }
}

async function createDraftOnce(
  repo: ContentRepository,
  tf: TypefullyGateway,
  actor: Actor,
  input: Input & { timing?: 'plan' | 'publish' | 'none' },
  options: TypefullyServiceOptions,
): Promise<MutationResult<LinkResult>> {
  const run = new Run<LinkResult>('create', input);
  const now = options.now ?? (() => new Date());
  if (actor.role !== 'owner') return run.fail('FORBIDDEN');
  if (!validInput(input)) return run.fail('VALIDATION_FAILED', { reason: 'invalid_input' });
  let loaded: Loaded;
  try {
    loaded = await loadRow(repo, input.contentId);
  } catch (error) {
    return run.fail(toAppError(error).code);
  }
  const gate = createGate(loaded.record, loaded.schedule);
  if (!gate.ok) return run.fail('GATE_BLOCKED', { reason: gate.reason, ...(gate.state ? { state: gate.state } : {}) });
  const { platform, text } = gate;
  const row = loaded.record.value;
  const key = createIdempotencyKey(input.operationId, input.contentId);

  // 1. Our own earlier attempt may already have created the draft (lost response).
  let mine: TypefullyDraft | null;
  try {
    mine = await call('find_by_key', input.contentId, () => tf.findByIdempotencyKey(key), input.operationId);
  } catch (error) {
    run.step('look up earlier attempt', 'typefully', 'failed', { errorCode: toAppError(error).code });
    return run.fail(toAppError(error).code, { reason: 'lookup_failed' });
  }

  if (row.typefullyDraftId) {
    if (mine && mine.id === row.typefullyDraftId) {
      run.step('create Typefully draft', 'typefully', 'skipped_already_applied');
      run.step('link Schedule row', 'sheet', 'skipped_already_applied', { revision: loaded.record.revision });
      return run.ok({ record: loaded.record, draft: mine }, true, { path: 'already_linked' });
    }
    return run.fail('CONFLICT', { reason: 'already_linked' });
  }

  let draft: TypefullyDraft;
  if (mine) {
    run.step('create Typefully draft', 'typefully', 'skipped_already_applied');
    draft = mine;
  } else {
    // 2. Something else may already exist for this slot. Never create over it.
    const rec = await reconcileLoaded(repo, tf, loaded, input.operationId);
    if (rec.kind === 'provider_error') return run.fail(rec.code, { reason: 'reconcile_failed' });
    if (rec.kind === 'invalid_row') return run.fail('VALIDATION_FAILED', { reason: rec.reason });
    if (rec.kind === 'single_match') return run.fail('CONFLICT', { reason: 'existing_match', reconciliation: rec }, { kind: rec.kind });
    if (rec.kind === 'ambiguous') return run.fail('AMBIGUOUS_MATCH', { reason: 'candidates_exist', reconciliation: rec }, { kind: rec.kind, candidates: rec.candidates.length });
    if (rec.kind === 'no_match' && !rec.searched) return run.fail('GATE_BLOCKED', { reason: 'no_planned_date' });
    if (rec.kind === 'linked') return run.fail('CONFLICT', { reason: 'already_linked' });

    const planned = plannedTaipeiIso(row);
    const timing = input.timing ?? 'plan';
    const scheduleAt = timing !== 'none' && planned && Date.parse(planned) > now().getTime() ? planned : undefined;
    try {
      draft = await call(
        'create_draft',
        input.contentId,
        () => tf.createDraft({ platform, text, idempotencyKey: key, ...(scheduleAt ? { scheduleAt, timing: timing === 'publish' ? 'publish' : 'plan' } : {}) }),
        input.operationId,
      );
      run.step('create Typefully draft', 'typefully', 'done');
    } catch (error) {
      const code = toAppError(error).code;
      run.step('create Typefully draft', 'typefully', 'failed', { errorCode: code });
      // The outcome is unknown: retrying the SAME operation looks the draft up first.
      return run.fail(code, { reason: 'create_outcome_unknown', retry: 'same_operation' });
    }
  }

  const w = await writeRow(run, repo, actor, input, { typefullyDraftId: draft.id, typefullyStatus: draft.status }, 'link Schedule row');
  if (!w.ok) {
    // Provider succeeded, Sheet did not: retry links this draft instead of creating another.
    return run.fail('PARTIAL_FAILURE', { reason: 'sheet_write_failed', draftId: draft.id, sheetCode: w.code, retry: 'same_operation' });
  }
  return run.ok({ record: w.record, draft }, Boolean(mine), { path: mine ? 'recovered' : 'created' });
}

// ------------------------------------------------------------------ Typefully -> Sheet (TYPE-04, PUB-04)

export type SyncResult = { record: ScheduleRecord; comparison: CopyComparison };

type PublicationFacts = { status: TypefullyStatus; publishedAt?: string; url?: string };

/** Published URL/time/status disagreements need a human, never an inferred fix (PUB-04). */
function publicationConflict(row: ScheduledPost, facts: PublicationFacts): string | null {
  if (row.publishedAt && facts.publishedAt && !sameInstant(row.publishedAt, facts.publishedAt)) return 'published_at_mismatch';
  if (row.postLink && facts.url && row.postLink !== facts.url) return 'post_link_mismatch';
  const rowStatus = row.typefullyStatus.ok ? row.typefullyStatus.value : null;
  if (rowStatus === 'Published' && facts.status !== 'Published') return 'status_regressed';
  return null;
}

function publicationPatch(record: ScheduleRecord, facts: PublicationFacts): SchedulePatch {
  const patch: SchedulePatch = {};
  if (record.cells.typefullyStatus !== facts.status) patch.typefullyStatus = facts.status;
  if (!record.value.publishedAt && facts.publishedAt) patch.publishedAt = toTaipeiIso(facts.publishedAt);
  if (!record.value.postLink && facts.url) patch.postLink = facts.url;
  return patch;
}

async function linkedDraft<T>(run: Run<T>, repo: ContentRepository, tf: TypefullyGateway, input: Input): Promise<{ loaded: Loaded; platform: Platform; draft: TypefullyDraft } | MutationResult<T>> {
  let loaded: Loaded;
  try {
    loaded = await loadRow(repo, input.contentId);
  } catch (error) {
    return run.fail(toAppError(error).code);
  }
  const row = loaded.record.value;
  const platform = platformOf(row);
  if (!platform) return run.fail('VALIDATION_FAILED', { reason: 'platform_unrecognised' });
  if (!row.typefullyDraftId) return run.fail('VALIDATION_FAILED', { reason: 'not_linked' });
  try {
    const draft = await call('get_draft', input.contentId, () => tf.getDraft(row.typefullyDraftId), input.operationId);
    run.step('fetch Typefully draft', 'typefully', 'done');
    if (viewText(draft, platform) === null) return run.fail('CONFLICT', { reason: 'platform_mismatch' });
    return { loaded, platform, draft };
  } catch (error) {
    run.step('fetch Typefully draft', 'typefully', 'failed', { errorCode: toAppError(error).code });
    return run.fail(toAppError(error).code);
  }
}

export async function syncFromTypefully(
  repo: ContentRepository,
  tf: TypefullyGateway,
  actor: Actor,
  input: Input & { resolve?: 'take_typefully' },
  options: TypefullyServiceOptions = {},
): Promise<MutationResult<SyncResult>> {
  const run = new Run<SyncResult>('sync_from_typefully', input);
  const now = options.now ?? (() => new Date());
  if (actor.role !== 'owner') return run.fail('FORBIDDEN');
  if (!validInput(input)) return run.fail('VALIDATION_FAILED', { reason: 'invalid_input' });
  const got = await linkedDraft(run, repo, tf, input);
  if ('ok' in got) return got;
  const { loaded, platform, draft } = got;
  const row = loaded.record.value;
  const comparison = compareCopy(row, draft);
  const text = comparison.typefully;
  const view = draft.perPlatform[platform];
  const publishedAt = view?.publishedAt ?? (draft.platforms.length === 1 ? draft.publishedAt : undefined);
  const facts: PublicationFacts = { status: draft.status, ...(publishedAt ? { publishedAt } : {}), ...(view?.url ? { url: view.url } : {}) };

  const pubConflict = publicationConflict(row, facts);
  if (pubConflict) return run.fail('CONFLICT', { reason: pubConflict, comparison }, { kind: 'publication' });

  // Never overwrite a Sheet edit to Final Content made after the last sync (TYPE-05).
  if (!comparison.identical && row.finalContent !== '' && input.resolve !== 'take_typefully') {
    if (comparison.sheetFinalEditedSinceSync === true) return run.fail('CONFLICT', { reason: 'sheet_final_edited', comparison }, { newer: comparison.newer });
    if (comparison.sheetFinalEditedSinceSync === null) return run.fail('CONFLICT', { reason: 'no_sync_baseline', comparison }, { newer: comparison.newer });
  }

  const stamp = parseSyncStamp(row.finalSyncedAt);
  const inSync = comparison.identical && stamp?.textHash === finalTextHash(text);
  const patch: SchedulePatch = { ...publicationPatch(loaded.record, facts) };
  if (!inSync) {
    // Exact provider text: no trim, no normalisation (TYPE-04). `Content` is never in this patch.
    patch.finalContent = text;
    patch.finalSyncedAt = formatSyncStamp(now(), text);
  }
  if (Object.keys(patch).length === 0) {
    run.step('write Schedule row', 'sheet', 'skipped_already_applied', { revision: loaded.record.revision });
    return run.ok({ record: loaded.record, comparison }, true, { path: 'in_sync' });
  }
  const w = await writeRow(run, repo, actor, input, patch, 'write Schedule row');
  if (!w.ok) return run.fail(w.code, w.details);
  return run.ok({ record: w.record, comparison: compareCopy(w.record.value, draft) }, w.replayed, { fields: Object.keys(patch).length });
}

// ------------------------------------------------------------------ Sheet -> Typefully (TYPE-05)

export async function pushToTypefully(
  repo: ContentRepository,
  tf: TypefullyGateway,
  actor: Actor,
  input: Input & { resolve?: 'take_sheet' },
  options: TypefullyServiceOptions = {},
): Promise<MutationResult<SyncResult>> {
  const run = new Run<SyncResult>('push_to_typefully', input);
  const now = options.now ?? (() => new Date());
  if (actor.role !== 'owner') return run.fail('FORBIDDEN');
  if (!validInput(input)) return run.fail('VALIDATION_FAILED', { reason: 'invalid_input' });
  const got = await linkedDraft(run, repo, tf, input);
  if ('ok' in got) return got;
  const { loaded, platform, draft } = got;
  const row = loaded.record.value;
  const comparison = compareCopy(row, draft);
  const text = row.finalContent !== '' ? row.finalContent : workingCopy(row, platform);
  if (text.trim() === '') return run.fail('GATE_BLOCKED', { reason: 'missing_copy' });

  let current = draft;
  if (comparison.typefully !== text) {
    if (draft.status === 'Published') return run.fail('CONFLICT', { reason: 'already_published', comparison });
    if (draft.platforms.length > 1) return run.fail('CONFLICT', { reason: 'multi_platform_draft', comparison });
    // Typefully edited since the last sync (or, never synced, since creation from the working copy).
    const tfEdited = comparison.typefullyEditedSinceSync ?? comparison.typefully !== workingCopy(row, platform);
    if (tfEdited && input.resolve !== 'take_sheet') return run.fail('CONFLICT', { reason: 'typefully_edited', comparison }, { newer: comparison.newer });
    try {
      current = await call('update_draft', input.contentId, () => tf.updateDraft(draft.id, { text, expectedUpdatedAt: draft.updatedAt }), input.operationId);
      run.step('update Typefully draft', 'typefully', 'done');
    } catch (error) {
      const code = toAppError(error).code;
      run.step('update Typefully draft', 'typefully', 'failed', { errorCode: code });
      return run.fail(code, code === 'CONFLICT' ? { reason: 'typefully_changed_during_push', comparison } : { reason: 'update_failed' });
    }
  } else {
    run.step('update Typefully draft', 'typefully', 'skipped_already_applied');
  }

  const stamp = parseSyncStamp(row.finalSyncedAt);
  const patch: SchedulePatch = {};
  if (row.finalContent !== text) patch.finalContent = text;
  if (stamp?.textHash !== finalTextHash(text)) patch.finalSyncedAt = formatSyncStamp(now(), text);
  if (loaded.record.cells.typefullyStatus !== current.status) patch.typefullyStatus = current.status;
  if (Object.keys(patch).length === 0) {
    run.step('write Schedule row', 'sheet', 'skipped_already_applied', { revision: loaded.record.revision });
    return run.ok({ record: loaded.record, comparison: compareCopy(row, current) }, true, { path: 'in_sync' });
  }
  const w = await writeRow(run, repo, actor, input, patch, 'write Schedule row');
  if (!w.ok) {
    return current !== draft ? run.fail('PARTIAL_FAILURE', { reason: 'sheet_write_failed', sheetCode: w.code, retry: 'same_operation' }) : run.fail(w.code, w.details);
  }
  return run.ok({ record: w.record, comparison: compareCopy(w.record.value, current) }, w.replayed);
}

// ------------------------------------------------------------------ analytics (CS-016)

export type AnalyticsResult = {
  record: ScheduleRecord;
  /** Metrics the provider supplied; any other metric is unavailable and stays blank. */
  supplied: TypefullyMetricKey[];
  unavailable: TypefullyMetricKey[];
};

const METRICS: TypefullyMetricKey[] = ['views', 'likes', 'reposts', 'replies', 'bookmarks', 'newFollowers'];

export async function syncAnalytics(
  repo: ContentRepository,
  tf: TypefullyGateway,
  actor: Actor,
  input: Input,
  options: TypefullyServiceOptions = {},
): Promise<MutationResult<AnalyticsResult>> {
  const run = new Run<AnalyticsResult>('sync_analytics', input);
  const now = options.now ?? (() => new Date());
  if (actor.role !== 'owner') return run.fail('FORBIDDEN');
  if (!validInput(input)) return run.fail('VALIDATION_FAILED', { reason: 'invalid_input' });
  let loaded: Loaded;
  try {
    loaded = await loadRow(repo, input.contentId);
  } catch (error) {
    return run.fail(toAppError(error).code);
  }
  const row = loaded.record.value;
  const platform = platformOf(row);
  if (!platform) return run.fail('VALIDATION_FAILED', { reason: 'platform_unrecognised' });
  if (!row.typefullyDraftId) return run.fail('VALIDATION_FAILED', { reason: 'not_linked' });

  let pub;
  try {
    // Metrics for this row's platform only: X and Threads never combine (PUB-01).
    pub = await call('get_publication', input.contentId, () => tf.getPublication(row.typefullyDraftId, platform), input.operationId);
    run.step('fetch publication', 'typefully', 'done');
  } catch (error) {
    run.step('fetch publication', 'typefully', 'failed', { errorCode: toAppError(error).code });
    return run.fail(toAppError(error).code);
  }
  const facts: PublicationFacts = { status: pub.status, ...(pub.publishedAt ? { publishedAt: pub.publishedAt } : {}), ...(pub.url ? { url: pub.url } : {}) };
  const conflict = publicationConflict(row, facts);
  if (conflict) return run.fail('CONFLICT', { reason: conflict }, { kind: 'publication' });
  if (pub.status !== 'Published') return run.fail('GATE_BLOCKED', { reason: 'not_published', status: pub.status });

  const supplied = METRICS.filter((k) => typeof pub.metrics?.[k] === 'number' && Number.isFinite(pub.metrics[k]));
  const unavailable = METRICS.filter((k) => !supplied.includes(k));
  const patch: SchedulePatch = { ...publicationPatch(loaded.record, facts) };
  for (const k of supplied) {
    const value = pub.metrics![k]!;
    if (row.metrics[k] !== value) patch[k] = String(value);
  }
  // Unavailable metrics are not in the patch: blank stays blank, a recorded value is never erased.
  if (Object.keys(patch).length === 0) {
    run.step('write analytics', 'sheet', 'skipped_already_applied', { revision: loaded.record.revision });
    return run.ok({ record: loaded.record, supplied, unavailable }, true, { path: 'unchanged', supplied: supplied.length });
  }
  patch.analyticsSyncedAt = toTaipeiIso(now());
  const w = await writeRow(run, repo, actor, input, patch, 'write analytics');
  if (!w.ok) return run.fail(w.code, w.details);
  return run.ok({ record: w.record, supplied, unavailable }, w.replayed, { supplied: supplied.length, fields: Object.keys(patch).length });
}
