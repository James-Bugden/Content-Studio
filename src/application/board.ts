import 'server-only';
import { backlogPills, postTab } from '@/domain/backlog';
import { evaluateLibraryGates } from '@/domain/gates';
import { libraryNextStep, slotNextStep, thumbFor, URGENCY_ORDER } from '@/domain/next-steps';
import type { Board, PostSummary, SlotSummary, Task } from '@/domain/board';
import type { LibraryRecord, ScheduleRecord, WorkflowSettings } from '@/domain/records';
import { addDays, hasScheduleActivity, isActiveScheduleSlot, parseContentId, slotAvailability, slotOrder, weekStart } from '@/domain/schedule';
import { scheduledPillar } from '@/domain/settings';
import { adaptationState } from '@/domain/zh-state';
import { serverEnv } from '@/lib/env';
import type { ContentRepository } from './ports';
import { lineageLibraryId, scheduledFacts } from './lineage';
import { stalePublishedRows } from './reconcile';
import { screenshotUses } from './review';
import { today } from './schedule';

/**
 * Board read model (UX redesign). One load gives Next up, the calendar and the
 * post panel the same facts: every Library post with its thumbnail and single
 * next step, every Schedule slot in a date window with its next step, and one
 * merged, ordered task list. Reads each Sheet tab once.
 */
export type { Board, PostSummary, SlotSummary, Task } from '@/domain/board';

/** Taipei wall-clock HH:MM now; fake mode pins the day via CS_FAKE_TODAY and uses 00:00. */
function taipeiNow(): string {
  if (serverEnv().CS_DATA_MODE === 'fake' && process.env.CS_FAKE_TODAY) return '00:00';
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
}

export async function loadBoard(repo: ContentRepository, opts: { from?: string; days?: number } = {}): Promise<Board> {
  const [library, schedule, settings] = await Promise.all([repo.listLibrary(), repo.listSchedule().catch(() => null), repo.workflowSettings()]);
  const day = today();
  const now = taipeiNow();
  const from = opts.from ?? weekStart(day);
  const to = addDays(from, (opts.days ?? 7) - 1);

  const posts = library.map((r) => summarisePost(r, library, schedule));
  const byId = new Map(library.map((r) => [r.value.libraryId, r]));
  const allPosts = (schedule ?? []).map((r) => r.value);
  const stale = new Set((schedule ? stalePublishedRows(schedule) : []).map((r) => r.value.contentId));

  const slots: SlotSummary[] = [];
  for (const r of schedule ?? []) {
    const parsed = parseContentId(r.value.contentId);
    if (!parsed || parsed.isoDate < from || parsed.isoDate > to) continue;
    if (!isActiveScheduleSlot(parsed.platform, parsed.slot) && !hasScheduleActivity(r)) continue;
    slots.push(summariseSlot(r, parsed, allPosts, byId, day, now, stale.has(r.value.contentId), settings));
  }
  const platformOrder: Record<string, number> = { X: 0, Threads: 1, LinkedIn: 2 };
  slots.sort((a, b) => a.isoDate.localeCompare(b.isoDate) || (platformOrder[a.platform] ?? 9) - (platformOrder[b.platform] ?? 9) || slotOrder(a.slot) - slotOrder(b.slot));

  // Tasks: slot steps in the next 14 days (from a fresh window if needed) and post steps.
  const upcoming: SlotSummary[] = [];
  const horizon = addDays(day, 13);
  for (const r of schedule ?? []) {
    const parsed = parseContentId(r.value.contentId);
    if (!parsed || parsed.isoDate < addDays(day, -2) || parsed.isoDate > horizon) continue;
    if (!isActiveScheduleSlot(parsed.platform, parsed.slot) && !hasScheduleActivity(r)) continue;
    upcoming.push(summariseSlot(r, parsed, allPosts, byId, day, now, stale.has(r.value.contentId), settings));
  }
  const tasks: Task[] = [];
  for (const s of upcoming) {
    if (s.step.urgency === 'none' || s.step.kind === 'wait') continue;
    tasks.push({ key: `slot:${s.contentId}`, step: s.step, title: s.empty ? `${s.platform} ${s.slot} slot` : s.hook || s.contentId, platform: s.platform, when: { isoDate: s.isoDate, time: s.time }, target: { slot: s.contentId } });
  }
  for (const p of posts) {
    if (p.step.urgency === 'none' || p.step.kind === 'wait' || p.step.kind === 'done') continue;
    tasks.push({ key: `post:${p.libraryId}`, step: p.step, title: p.title || p.hook || p.libraryId, platform: p.platform, target: { post: p.libraryId } });
  }
  tasks.sort(
    (a, b) =>
      URGENCY_ORDER[a.step.urgency] - URGENCY_ORDER[b.step.urgency] ||
      (a.when && b.when ? `${a.when.isoDate} ${a.when.time}`.localeCompare(`${b.when.isoDate} ${b.when.time}`) : a.when ? -1 : b.when ? 1 : 0),
  );

  const weekSlots = slots.filter((s) => s.isoDate >= weekStart(day) && s.isoDate <= addDays(weekStart(day), 6));
  return {
    today: day,
    now,
    posts,
    slots,
    window: { from, to },
    tasks,
    counts: {
      review: posts.filter((p) => p.step.kind === 'review').length,
      images: posts.filter((p) => ['choose_image', 'finish_image', 'approve_image'].includes(p.step.kind)).length,
      ready: posts.filter((p) => p.step.kind === 'schedule').length,
      openSlotsThisWeek: weekSlots.filter((s) => s.step.kind === 'fill_slot').length,
      problems: [...posts.map((p) => p.step), ...upcoming.map((s) => s.step)].filter((s) => s.urgency === 'now').length,
    },
  };
}

function summarisePost(r: LibraryRecord, library: LibraryRecord[], schedule: ScheduleRecord[] | null): PostSummary {
  const item = r.value;
  const gates = evaluateLibraryGates(item, {
    purpose: item.reviewStatus.ok && item.reviewStatus.value === 'Approved' ? 'ready' : 'review',
    zh: 'not_required',
    screenshotUses: schedule === null && item.visual.source.kind === 'screenshot' ? null : screenshotUses(item, library, schedule ?? []),
  });
  const facts = schedule ? scheduledFacts(item.libraryId, schedule) : [];
  const scheduled = facts.map((s) => s.contentId);
  const step = libraryNextStep(gates, scheduled.length > 0);
  const thumb = thumbFor(item.libraryId, item);
  const text = item.draftContent;
  return {
    libraryId: item.libraryId,
    title: item.slug.replace(/-/g, ' ').trim(),
    platform: item.targetPlatform.ok ? item.targetPlatform.value : 'Unknown',
    source: item.contentSource,
    hook: item.currentHook,
    preview: text.length > 220 ? `${text.slice(0, 219)}…` : text,
    thumb,
    status: scheduled.length ? 'scheduled' : gates.status,
    step,
    scheduledAs: scheduled,
    reviewStatus: item.reviewStatus.ok ? (item.reviewStatus.value === 'Pending' ? 'Not reviewed' : item.reviewStatus.value) : 'Unrecognised',
    tab: postTab(step, facts, gates.status),
    pills: backlogPills({
      gates,
      reviewStatus: item.reviewStatus.ok ? item.reviewStatus.value : null,
      platform: item.targetPlatform.ok ? item.targetPlatform.value : '',
      thumb,
      scheduled: facts,
    }),
  };
}

function summariseSlot(
  r: ScheduleRecord,
  parsed: NonNullable<ReturnType<typeof parseContentId>>,
  all: ScheduleRecord['value'][],
  byId: Map<string, LibraryRecord>,
  day: string,
  now: string,
  staleSync: boolean,
  settings: WorkflowSettings,
): SlotSummary {
  const v = r.value;
  const time = v.publishTime.trim();
  const past = parsed.isoDate < day || (parsed.isoDate === day && Boolean(time) && time < now);
  const hasCopy = Boolean(v.hook.trim() || v.content.trim() || v.chineseContent.trim());
  const zh = parsed.platform === 'X' && hasCopy ? adaptationState(v, all) : undefined;
  const parent = parsed.platform === 'Threads' && v.parentContentId ? all.find((p) => p.contentId === v.parentContentId) : undefined;
  const parentZh = parent && parent.hook ? adaptationState(parent, all) : undefined;
  const libraryId = lineageLibraryId(v.sourceLink);
  const lib = libraryId ? byId.get(libraryId) : undefined;
  const status = v.typefullyStatus.ok ? v.typefullyStatus.value : 'Unrecognised';
  const stage = v.contentStage ? (v.contentStage.ok ? v.contentStage.value : 'Unrecognised') : null;
  const step = slotNextStep({ post: v, ...(zh ? { zh } : {}), ...(parentZh ? { parentZh } : {}), past, staleSync });
  return {
    contentId: v.contentId,
    isoDate: parsed.isoDate,
    slot: parsed.slot,
    platform: parsed.platform,
    time: time || 'No time',
    expectedPillar: scheduledPillar(settings, parsed.isoDate, parsed.platform, parsed.slot),
    hook: v.hook || v.chineseContent.split('\n')[0] || '',
    statusLabel: !hasCopy ? (slotAvailability(r).available ? 'Open' : 'Empty') : status !== 'Not Sent' ? status : stage ?? 'In progress',
    thumb: lib ? thumbFor(lib.value.libraryId, lib.value) : v.visual.source.kind === 'text_only' ? { src: null, label: 'Text only', tone: 'done' } : null,
    libraryId,
    parentContentId: v.parentContentId,
    step,
    empty: !hasCopy,
  };
}
