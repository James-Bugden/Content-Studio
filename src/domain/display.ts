import type { Task } from './board';
import type { NextStep } from './next-steps';

/**
 * Plain-language display helpers (UX redesign), shared by Next up and Posts.
 * Pure and client-safe: no ids, no enum names, no technical detail on screen.
 */

/** Capitalise the first letter only; the rest is left as written. */
export function sentenceCase(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ');
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
}

/** A readable post title from its slug: dashes become spaces, first letter capital. */
export function readableTitle(slug: string): string {
  return sentenceCase(slug.replace(/[-_]+/g, ' '));
}

const PLATFORM_NAMES: Record<string, string> = { x: 'X', threads: 'Threads', linkedin: 'LinkedIn' };

/** Platform name for a badge ("LinkedIn", "X", "Threads"); anything else reads as unknown. */
export function platformName(platform: string): string {
  return PLATFORM_NAMES[platform.trim().toLowerCase()] ?? 'Unknown platform';
}

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function parseIso(isoDate: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) || d.getUTCDate() !== Number(m[3]) ? null : d;
}

/** "Wednesday 30 September 2026" for a Taipei calendar date (YYYY-MM-DD). */
export function longDate(isoDate: string): string {
  const d = parseIso(isoDate);
  if (!d) return '';
  return `${WEEKDAY[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "Thu 1 Oct, 20:00" for a slot; the time is left out when none is set. */
export function shortWhen(when: { isoDate: string; time: string }): string {
  const d = parseIso(when.isoDate);
  if (!d) return '';
  const day = `${WEEKDAY[d.getUTCDay()]!.slice(0, 3)} ${d.getUTCDate()} ${MONTH[d.getUTCMonth()]!.slice(0, 3)}`;
  return /^\d{1,2}:\d{2}$/.test(when.time.trim()) ? `${day}, ${when.time.trim()}` : day;
}

/** "Next: Rework copy, copyright QA says this needs rework." */
export function nextLine(step: Pick<NextStep, 'action' | 'why'>): string {
  const why = step.why.trim();
  // Lower-case the first word of the reason unless it is an acronym or a name like "X".
  const soft = why.length > 1 && /^[A-Z][a-z]/.test(why) ? why.charAt(0).toLowerCase() + why.slice(1) : why;
  return soft ? `Next: ${step.action}, ${soft}` : `Next: ${step.action}`;
}

/** Title for a task row: sentence case, never an id. */
export function taskTitle(task: Pick<Task, 'title' | 'target' | 'platform'>): string {
  const id = 'post' in task.target ? task.target.post : task.target.slot;
  const title = task.title.trim();
  if (!title || title === id) return 'post' in task.target ? 'Untitled post' : `${platformName(task.platform)} slot`;
  return sentenceCase(title);
}

/** Next up lists: everything urgent now, then up to `max` soon tasks with the rest behind "Show all". */
export function splitTasks<T extends { step: Pick<NextStep, 'urgency'> }>(tasks: T[], max = 12): { now: T[]; next: T[]; more: T[] } {
  const now = tasks.filter((t) => t.step.urgency === 'now');
  const soon = tasks.filter((t) => t.step.urgency === 'soon');
  return { now, next: soon.slice(0, max), more: soon.slice(max) };
}
