import type { SlotSummary } from './board';
import { URGENCY_ORDER } from './next-steps';
import { addDays, weekStart } from './schedule';

/**
 * Calendar helpers (UX redesign). Pure and timezone-independent: every date is a
 * Taipei ISO date taken from a Content ID, and all arithmetic is UTC day maths, so
 * a browser in Los Angeles sees the same days as one in Taipei.
 */

export const CALENDAR_VIEWS = ['week', 'month', 'list'] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

export const CALENDAR_PLATFORMS = ['X', 'Threads', 'LinkedIn'] as const;
export type CalendarPlatform = (typeof CALENDAR_PLATFORMS)[number];

export function parseView(raw: unknown): CalendarView {
  return typeof raw === 'string' && (CALENDAR_VIEWS as readonly string[]).includes(raw) ? (raw as CalendarView) : 'week';
}

/** A real calendar date as `YYYY-MM-DD`, or null. */
export function parseIsoDate(raw: unknown): string | null {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [y, m, d] = raw.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.toISOString().slice(0, 10) === raw ? raw : null;
}

/** A month as `YYYY-MM`, or null. */
export function parseMonth(raw: unknown): string | null {
  if (typeof raw !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(raw)) return null;
  return raw;
}

export function monthOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

export type MonthGrid = { month: string; first: string; days: string[] };

/**
 * Whole Monday-to-Sunday weeks covering a month: 28 to 42 days, starting on the
 * Monday on or before the 1st and ending on the Sunday on or after the last day.
 */
export function monthGrid(month: string): MonthGrid {
  const firstOfMonth = `${month}-01`;
  const lastOfMonth = addDays(`${addMonths(month, 1)}-01`, -1);
  const first = weekStart(firstOfMonth);
  const last = addDays(weekStart(lastOfMonth), 6);
  const days: string[] = [];
  for (let d = first; d <= last; d = addDays(d, 1)) days.push(d);
  return { month, first, days };
}

function utc(isoDate: string): Date {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

/** "Thursday 1 October" */
export function formatDayLong(isoDate: string): string {
  return utc(isoDate).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
}

/** { weekday: "Thu", date: "1 Oct" } */
export function formatDayShort(isoDate: string): { weekday: string; date: string } {
  const d = utc(isoDate);
  return {
    weekday: d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' }),
    date: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
  };
}

/** "October 2026" */
export function formatMonth(month: string): string {
  return utc(`${month}-01`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** "28 Sept to 4 Oct 2026" */
export function formatWeekRange(start: string): string {
  const end = addDays(start, 6);
  const a = utc(start).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const b = utc(end).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return `${a} to ${b}`;
}

const PLATFORM_ORDER: Record<string, number> = { X: 0, Threads: 1, LinkedIn: 2 };
const timeKey = (t: string) => (/^\d{2}:\d{2}$/.test(t) ? t : '99:99');

/** Slots in the order they happen: by time, then platform; slots with no time last. */
export function sortByTime(slots: SlotSummary[]): SlotSummary[] {
  return [...slots].sort(
    (a, b) => a.isoDate.localeCompare(b.isoDate) || timeKey(a.time).localeCompare(timeKey(b.time)) || (PLATFORM_ORDER[a.platform] ?? 9) - (PLATFORM_ORDER[b.platform] ?? 9),
  );
}

export type DayCount = { platform: CalendarPlatform; filled: number; total: number };

/** Filled and total slots per platform for one day, skipping platforms with no slots. */
export function dayCounts(slots: SlotSummary[]): DayCount[] {
  return CALENDAR_PLATFORMS.map((platform) => {
    const mine = slots.filter((s) => s.platform === platform);
    return { platform, filled: mine.filter((s) => !s.empty).length, total: mine.length };
  }).filter((c) => c.total > 0);
}

export function urgentCount(slots: SlotSummary[]): number {
  return slots.filter((s) => s.step.urgency === 'now').length;
}

/** A slot has something to do: a real step that is due now or soon. */
export function needsAction(s: SlotSummary): boolean {
  return (s.step.urgency === 'now' || s.step.urgency === 'soon') && s.step.kind !== 'wait' && s.step.kind !== 'done';
}

/** Slots in [from, to] that need the owner, most urgent first, then in time order. */
export function needsYou(slots: SlotSummary[], from: string, to: string): SlotSummary[] {
  return sortByTime(slots.filter((s) => s.isoDate >= from && s.isoDate <= to && needsAction(s))).sort(
    (a, b) => URGENCY_ORDER[a.step.urgency] - URGENCY_ORDER[b.step.urgency],
  );
}

export type ListItem = { kind: 'slot'; slot: SlotSummary } | { kind: 'run'; slots: SlotSummary[] };

/**
 * Collapse runs of consecutive empty slots (in the order given) into one item, so a
 * day with five unused slots reads as one line instead of five. Runs shorter than
 * `min` stay as single slots.
 */
export function collapseEmptyRuns(slots: SlotSummary[], min = 2): ListItem[] {
  const out: ListItem[] = [];
  let run: SlotSummary[] = [];
  const flush = () => {
    if (run.length >= min) out.push({ kind: 'run', slots: run });
    else for (const s of run) out.push({ kind: 'slot', slot: s });
    run = [];
  };
  for (const s of slots) {
    if (s.empty) run.push(s);
    else {
      flush();
      out.push({ kind: 'slot', slot: s });
    }
  }
  flush();
  return out;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "3 open slots, 2 waiting for X" */
export function runSummary(slots: SlotSummary[]): string {
  const open = slots.filter((s) => s.step.kind === 'fill_slot').length;
  const waiting = slots.filter((s) => s.step.kind === 'wait').length;
  const missed = slots.filter((s) => s.step.kind === 'done' && s.step.action === 'Missed').length;
  const other = slots.length - open - waiting - missed;
  const parts: string[] = [];
  if (open) parts.push(plural(open, 'open slot', 'open slots'));
  if (waiting) parts.push(`${waiting} waiting for X`);
  if (missed) parts.push(`${missed} missed`);
  if (other) parts.push(plural(other, 'empty slot', 'empty slots'));
  return parts.join(', ');
}

/** Days worth listing: any content, or an open slot to fill. */
export function dayWorthListing(slots: SlotSummary[]): boolean {
  return slots.some((s) => !s.empty || s.step.kind === 'fill_slot');
}

export type SlotLook = 'published' | 'scheduled' | 'review' | 'open' | 'waiting' | 'missed' | 'problem';
export type SlotStatus = { glyph: string; label: string; look: SlotLook };

/** Status in words with a glyph, so it never depends on colour (UX-07). */
export function slotStatus(s: SlotSummary): SlotStatus {
  if (s.step.kind === 'done' && s.step.action === 'Missed') return { glyph: '×', label: 'Missed', look: 'missed' };
  if (s.empty) {
    if (s.step.kind === 'wait') return { glyph: '·', label: 'Waiting for X', look: 'waiting' };
    return { glyph: '○', label: 'Open', look: 'open' };
  }
  switch (s.statusLabel) {
    case 'Published':
      return { glyph: '✓', label: 'Published', look: 'published' };
    case 'Scheduled':
      return { glyph: '◐', label: 'Scheduled', look: 'scheduled' };
    case 'Planned':
    case 'Typefully Draft':
      return { glyph: '◐', label: 'Planned', look: 'scheduled' };
    case 'Error':
      return { glyph: '●', label: 'Typefully error', look: 'problem' };
    case 'Unrecognised':
      return { glyph: '●', label: 'Check the Sheet', look: 'problem' };
    default:
      return { glyph: '◑', label: 'In review', look: 'review' };
  }
}
