import 'server-only';
import { AppError, type ErrorCode } from '@/domain/errors';
import type { Gate } from '@/domain/gates';
import type { Actor } from '@/domain/mutation';
import type { LibraryRecord, ScheduleRecord } from '@/domain/records';
import { addDays, hasScheduleActivity, isActiveScheduleSlot, parseContentId, planPromotion, slotAvailability, slotOrder, taipeiToday, weekStart, type PreviewRow } from '@/domain/schedule';
import { scheduledPillar } from '@/domain/settings';
import { adaptationState } from '@/domain/zh-state';
import { emit, targetHash } from '@/observability/events';
import { serverEnv } from '@/lib/env';
import { markdownFileId } from './markdown-source';
import type { ContentRepository } from './ports';
import { evaluateReady, lineageLibraryId, scheduledRowsFor } from './ready';

/**
 * Calendar and Schedule promotion (CS-014).
 *
 * New content never jumps straight into Content Schedule: promotion starts from
 * a Library row, re-runs every Ready gate server-side (SCHED-05), needs an
 * explicit preview and confirmation, re-checks both the Library and the slot
 * row revisions, and writes named cells into one available pre-created slot row.
 * Occupied, scheduled or published rows are never overwritten (SCHED-03).
 *
 * Taipei today. In fake mode only, CS_FAKE_TODAY pins the date so synthetic
 * fixtures with fixed dates stay schedulable in tests; live mode ignores it.
 */
export function today(): string {
  const env = serverEnv();
  const pinned = process.env.CS_FAKE_TODAY;
  if (env.CS_DATA_MODE === 'fake' && pinned && /^\d{4}-\d{2}-\d{2}$/.test(pinned)) return pinned;
  return taipeiToday();
}

export type CalendarCell = {
  contentId: string;
  platform: string;
  slot: string;
  time: string;
  expectedPillar: string | null;
  isoDate: string;
  displayDate: string;
  stage: string;
  typefullyStatus: string;
  hook: string;
  parentContentId: string;
  libraryId: string | null;
  available: boolean;
  zh?: string;
  revision: string;
};

export type CalendarWeek = { start: string; days: { isoDate: string; cells: CalendarCell[] }[]; unparsed: number };

function toCell(r: ScheduleRecord, all: ScheduleRecord[], settings: Awaited<ReturnType<ContentRepository['workflowSettings']>>): CalendarCell | null {
  const parsed = parseContentId(r.value.contentId);
  if (!parsed) return null;
  const v = r.value;
  if (!isActiveScheduleSlot(parsed.platform, parsed.slot) && !hasScheduleActivity(r)) return null;
  return {
    contentId: v.contentId,
    platform: parsed.platform,
    slot: parsed.slot,
    time: v.publishTime || 'Not set',
    expectedPillar: scheduledPillar(settings, parsed.isoDate, parsed.platform, parsed.slot),
    isoDate: parsed.isoDate,
    displayDate: v.date,
    stage: v.contentStage ? (v.contentStage.ok ? v.contentStage.value : 'Unrecognised') : 'Empty',
    typefullyStatus: v.typefullyStatus.ok ? v.typefullyStatus.value : 'Unrecognised',
    hook: v.hook || v.chineseContent.split('\n')[0] || '',
    parentContentId: v.parentContentId,
    libraryId: lineageLibraryId(v.sourceLink),
    available: slotAvailability(r).available,
    ...(parsed.platform === 'X' && v.hook ? { zh: adaptationState(v, all.map((x) => x.value)) } : {}),
    revision: r.revision,
  };
}

export async function loadCalendar(repo: ContentRepository, week?: string): Promise<CalendarWeek> {
  const [schedule, settings] = await Promise.all([repo.listSchedule(), repo.workflowSettings()]);
  const start = weekStart(week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? week : today());
  const days = Array.from({ length: 7 }, (_, i) => ({ isoDate: addDays(start, i), cells: [] as CalendarCell[] }));
  let unparsed = 0;
  for (const r of schedule) {
    const cell = toCell(r, schedule, settings);
    if (!cell) {
      if (r.value.contentId && !parseContentId(r.value.contentId)) unparsed += 1;
      continue;
    }
    const day = days.find((d) => d.isoDate === cell.isoDate);
    if (day) day.cells.push(cell);
  }
  const platformOrder = { X: 0, Threads: 1, LinkedIn: 2 } as Record<string, number>;
  for (const d of days) d.cells.sort((a, b) => a.time.localeCompare(b.time) || (platformOrder[a.platform] ?? 9) - (platformOrder[b.platform] ?? 9) || slotOrder(a.slot) - slotOrder(b.slot));
  return { start, days, unparsed };
}

export type SlotOption = { contentId: string; isoDate: string; slot: string; time: string; revision: string; ok: boolean; problems: string[] };

export type PromotionContext = {
  library: LibraryRecord;
  gates: Gate[];
  group: string;
  alreadyScheduled: { contentId: string; date: string; slot: string }[];
  options: SlotOption[];
};

async function readAll(repo: ContentRepository) {
  const [library, schedule, settings] = await Promise.all([repo.listLibrary(), repo.listSchedule(), repo.workflowSettings()]);
  return { library, schedule, settings };
}

function markdownLinkOf(record: LibraryRecord): string {
  const id = markdownFileId(record);
  return record.links.sourceMarkdown ?? (id ? `https://drive.google.com/file/d/${id}/view` : '');
}

export async function promotionContext(repo: ContentRepository, libraryId: string, horizonDays = 21): Promise<PromotionContext> {
  const { library, schedule, settings } = await readAll(repo);
  const record = library.find((r) => r.value.libraryId === libraryId);
  if (!record) throw new AppError('NOT_FOUND');
  const ready = evaluateReady(record, library, schedule);
  const target = record.value.targetPlatform.ok ? record.value.targetPlatform.value : null;
  const from = today();
  const last = addDays(from, horizonDays);
  const options: SlotOption[] = [];
  for (const r of schedule) {
    const parsed = parseContentId(r.value.contentId);
    if (!parsed || parsed.platform !== target || parsed.isoDate < from || parsed.isoDate > last) continue;
    if (!slotAvailability(r).available) continue;
    const plan = planPromotion(record, r, settings, markdownLinkOf(record));
    options.push({
      contentId: r.value.contentId,
      isoDate: parsed.isoDate,
      slot: parsed.slot,
      time: plan.ok ? plan.slotTime : r.value.publishTime || 'TBD',
      revision: r.revision,
      ok: plan.ok,
      problems: plan.ok ? [] : plan.problems,
    });
  }
  options.sort((a, b) => a.isoDate.localeCompare(b.isoDate) || slotOrder(a.slot) - slotOrder(b.slot));
  return { library: record, gates: ready.gates.blockers, group: ready.group, alreadyScheduled: ready.scheduledAs, options };
}

export type PromotionPreview =
  | { ok: true; libraryId: string; contentId: string; libraryRevision: string; scheduleRevision: string; preview: PreviewRow[] }
  | { ok: false; code: ErrorCode; problems: string[]; blockers?: Gate[] };

export async function previewPromotion(repo: ContentRepository, libraryId: string, contentId: string): Promise<PromotionPreview> {
  const { library, schedule, settings } = await readAll(repo);
  const record = library.find((r) => r.value.libraryId === libraryId);
  const row = schedule.filter((r) => r.value.contentId === contentId);
  if (!record || row.length !== 1) return { ok: false, code: 'NOT_FOUND', problems: ['The Library item or the slot row was not found (or the Content ID is duplicated).'] };
  const ready = evaluateReady(record, library, schedule);
  if (ready.group === 'scheduled') return { ok: false, code: 'CONFLICT', problems: [`Already scheduled as ${ready.scheduledAs.map((s) => s.contentId).join(', ')}.`] };
  if (ready.group !== 'ready') return { ok: false, code: 'GATE_BLOCKED', problems: ['This item is not Ready.'], blockers: ready.gates.blockers };
  const plan = planPromotion(record, row[0]!, settings, markdownLinkOf(record));
  if (!plan.ok) return { ok: false, code: 'VALIDATION_FAILED', problems: plan.problems };
  return { ok: true, libraryId, contentId, libraryRevision: record.revision, scheduleRevision: row[0]!.revision, preview: plan.preview };
}

export type PromoteInput = {
  operationId: string;
  libraryId: string;
  contentId: string;
  expectedLibraryRevision: string;
  expectedScheduleRevision: string;
};

export type PromoteResult =
  | { ok: true; replayed: boolean; contentId: string; revision: string }
  | { ok: false; code: ErrorCode; problems?: string[]; blockers?: Gate[] };

export async function promote(repo: ContentRepository, actor: Actor, input: PromoteInput): Promise<PromoteResult> {
  const done = (r: PromoteResult): PromoteResult => {
    emit({ name: 'schedule.promote', adapter: 'app', outcome: r.ok ? (r.replayed ? 'replayed' : 'ok') : r.code === 'GATE_BLOCKED' ? 'blocked' : r.code === 'STALE_READ' || r.code === 'CONFLICT' ? 'conflict' : 'error', operationId: input.operationId, targetHash: targetHash(input.contentId), ...(r.ok ? {} : { code: r.code }) });
    return r;
  };
  if (actor.role !== 'owner') return done({ ok: false, code: 'FORBIDDEN' });
  const { library, schedule, settings } = await readAll(repo);
  const record = library.find((r) => r.value.libraryId === input.libraryId);
  const rows = schedule.filter((r) => r.value.contentId === input.contentId);
  if (!record) return done({ ok: false, code: 'NOT_FOUND', problems: ['Only Content Library items can be promoted.'] });
  if (rows.length !== 1) return done({ ok: false, code: rows.length === 0 ? 'NOT_FOUND' : 'CONFLICT', problems: ['The slot row is missing or its Content ID is duplicated.'] });
  const row = rows[0]!;

  // Lost-response replay: this exact item already sits in this exact slot.
  const mine = scheduledRowsFor(input.libraryId, schedule);
  if (mine.some((r) => r.value.contentId === input.contentId) && row.value.hook === record.value.currentHook && row.value.content === record.value.draftContent) {
    return done({ ok: true, replayed: true, contentId: input.contentId, revision: row.revision });
  }
  if (mine.length > 0) return done({ ok: false, code: 'CONFLICT', problems: [`Already scheduled as ${mine.map((r) => r.value.contentId).join(', ')}.`] });
  if (record.revision !== input.expectedLibraryRevision) return done({ ok: false, code: 'STALE_READ', problems: ['The Library item changed after the preview. Review the new preview.'] });
  if (row.revision !== input.expectedScheduleRevision) return done({ ok: false, code: 'STALE_READ', problems: ['The slot row changed after the preview. Review the new preview.'] });

  const ready = evaluateReady(record, library, schedule);
  if (ready.group !== 'ready') return done({ ok: false, code: 'GATE_BLOCKED', blockers: ready.gates.blockers });
  const plan = planPromotion(record, row, settings, markdownLinkOf(record));
  if (!plan.ok) return done({ ok: false, code: 'VALIDATION_FAILED', problems: plan.problems });

  const res = await repo.updateSchedule({ operationId: input.operationId, actor, target: { contentId: input.contentId }, expectedRevision: row.revision, patch: plan.patch });
  if (!res.ok) return done({ ok: false, code: res.code });
  return done({ ok: true, replayed: res.replayed, contentId: input.contentId, revision: res.value.revision });
}
