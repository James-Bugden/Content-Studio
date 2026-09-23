import 'server-only';
import { AppError, type ErrorCode } from '@/domain/errors';
import type { MutationResult, StepResult } from '@/domain/mutation';
import type { ScheduleRecord } from '@/domain/records';
import { formatVisualSource } from '@/domain/visual';
import { contentIdDate, plannedTaipeiIso } from '@/domain/typefully';
import type { CandidateView, ScheduleRowFacts, TypefullyDetailView, TypefullyPanelView } from '@/domain/typefully-view';
import { adaptationState } from '@/domain/zh-state';
import type { ContentRepository, TypefullyDraft, TypefullyGateway } from './ports';
import { lineageLibraryId } from './ready';
import { reconcile, type ReconcileCandidate, type Reconciliation } from './typefully';

/**
 * Maps Typefully reconciliation and mutation results to client-safe views
 * (CS-015). Routes and pages return these, never the provider's draft objects:
 * no idempotency markers, no provider-only fields, only what a person decides on.
 */
function candidateView(c: ReconcileCandidate): CandidateView {
  const platform = c.discriminators.platform;
  const text = c.draft.perPlatform[platform]?.text ?? (c.draft.platform === platform ? c.draft.text : '');
  return { ...c.discriminators, text };
}

function linkedDraft(d: TypefullyDraft) {
  return {
    draftId: d.id,
    status: d.status,
    platforms: d.platforms,
    scheduledAt: d.scheduledAt ?? null,
    updatedAt: d.updatedAt,
    publishedAt: d.publishedAt ?? null,
    url: d.url ?? null,
  };
}

export function panelView(rec: Reconciliation): TypefullyPanelView {
  switch (rec.kind) {
    case 'linked':
      return { kind: 'linked', draft: linkedDraft(rec.draft), comparison: rec.comparison, platformMismatch: rec.platformMismatch };
    case 'single_match':
      return { kind: 'single_match', row: rec.row, candidate: candidateView(rec.candidate) };
    case 'ambiguous':
      return { kind: 'ambiguous', row: rec.row, candidates: rec.candidates.map(candidateView) };
    case 'no_match':
      return { kind: 'no_match', row: rec.row, searched: rec.searched };
    case 'invalid_row':
      return { kind: 'invalid_row', reason: rec.reason };
    case 'provider_error':
      return { kind: 'provider_error', provider: rec.provider, code: rec.code };
  }
}

export function rowFacts(record: ScheduleRecord, schedule: readonly ScheduleRecord[]): ScheduleRowFacts {
  const v = record.value;
  const platform = v.platform?.ok ? v.platform.value : null;
  let zh: ScheduleRowFacts['zh'] = null;
  if (platform === 'Threads') {
    const xContentId = v.parentContentId || v.contentId.replace(/-TH$/, '-X');
    const parent = schedule.find((r) => r.value.contentId === xContentId);
    zh = { xContentId, state: parent ? adaptationState(parent.value, schedule.map((r) => r.value)) : 'missing' };
  }
  return {
    contentId: v.contentId,
    parentContentId: v.parentContentId,
    platform,
    platformRaw: v.platform ? (v.platform.ok ? v.platform.value : v.platform.raw) : '',
    slot: v.slot,
    displayDate: v.date,
    isoDate: contentIdDate(v.contentId),
    publishTime: v.publishTime,
    plannedAt: plannedTaipeiIso(v),
    stage: v.contentStage ? (v.contentStage.ok ? v.contentStage.value : 'Unrecognised') : 'Empty',
    typefullyStatus: v.typefullyStatus.ok ? v.typefullyStatus.value : 'Unrecognised',
    draftId: v.typefullyDraftId,
    libraryId: lineageLibraryId(v.sourceLink),
    visual: {
      source: formatVisualSource(v.visual.source) || 'Not decided',
      version: v.visual.version,
      imageStatus: v.visual.imageStatus.ok ? v.visual.imageStatus.value : v.visual.imageStatus.raw,
    },
    zh,
    revision: record.revision,
  };
}

export async function loadTypefullyDetail(repo: ContentRepository, tf: TypefullyGateway, contentId: string): Promise<TypefullyDetailView> {
  const schedule = await repo.listSchedule();
  const found = schedule.filter((r) => r.value.contentId === contentId);
  if (found.length === 0) throw new AppError('NOT_FOUND');
  if (found.length > 1) throw new AppError('CONFLICT', { reason: 'duplicate_id' });
  const rec = await reconcile(repo, tf, contentId);
  return { row: rowFacts(found[0]!, schedule), panel: panelView(rec), capability: tf.capability() };
}

/** Safe detail keys a client may see on a failed Typefully mutation. */
const DETAIL_KEYS = ['reason', 'state', 'status', 'comparison', 'contentId', 'retry', 'sheetCode'] as const;

export type ClientMutationResult =
  | { ok: true; operationId: string; replayed: boolean; revision: string; typefullyStatus?: string; supplied?: string[]; unavailable?: string[] }
  | { ok: false; operationId: string; code: ErrorCode; steps: StepResult[]; details?: Record<string, unknown> };

export function clientResult(result: MutationResult<{ record: ScheduleRecord; supplied?: string[]; unavailable?: string[] }>): ClientMutationResult {
  if (result.ok) {
    const v = result.value;
    return {
      ok: true,
      operationId: result.operationId,
      replayed: result.replayed,
      revision: v.record.revision,
      typefullyStatus: v.record.cells.typefullyStatus,
      ...(v.supplied ? { supplied: v.supplied } : {}),
      ...(v.unavailable ? { unavailable: v.unavailable } : {}),
    };
  }
  const details: Record<string, unknown> = {};
  for (const key of DETAIL_KEYS) if (result.details && key in result.details) details[key] = result.details[key];
  const rec = result.details?.reconciliation as Reconciliation | undefined;
  if (rec && typeof rec === 'object' && 'kind' in rec) details.reconciliation = panelView(rec);
  return { ok: false, operationId: result.operationId, code: result.code, steps: result.steps, ...(Object.keys(details).length ? { details } : {}) };
}
