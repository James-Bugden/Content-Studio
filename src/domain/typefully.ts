import type { Platform } from './enums';
import { shortHash } from './hash';
import type { ScheduledPost } from './records';

/**
 * Pure Typefully reconciliation helpers (CS-015/016).
 *
 * Times: the Sheet plans in Taipei local time (`Publish Time (Taipei)` plus the
 * date encoded in the Content ID, because the `Date` cell is a display value such
 * as `Thu 1 Oct` with no year). Typefully returns UTC instants. Everything is
 * compared as instants; everything the app writes is ISO 8601 with `+08:00`.
 */
export const TAIPEI_OFFSET_MINUTES = 8 * 60;
const CONTENT_ID_DATE = /^(\d{4}-\d{2}-\d{2})-/;
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** `YYYY-MM-DD` from a Content ID such as `2026-10-01-MAIN-X`, or null. */
export function contentIdDate(contentId: string): string | null {
  const m = CONTENT_ID_DATE.exec(contentId.trim());
  if (!m) return null;
  return Number.isNaN(Date.parse(`${m[1]}T00:00:00+08:00`)) ? null : m[1]!;
}

/** Planned Taipei instant as ISO with `+08:00`, or null when date or time is unknown (e.g. `TBD`). */
export function plannedTaipeiIso(post: Pick<ScheduledPost, 'contentId' | 'publishTime'>): string | null {
  const date = contentIdDate(post.contentId);
  const time = HHMM.exec(post.publishTime.trim());
  if (!date || !time) return null;
  return `${date}T${time[1]}:${time[2]}:00+08:00`;
}

/** Format an instant as `YYYY-MM-DDTHH:MM:SS+08:00`. */
export function toTaipeiIso(instant: Date | string): string {
  const ms = typeof instant === 'string' ? Date.parse(instant) : instant.getTime();
  const local = new Date(ms + TAIPEI_OFFSET_MINUTES * 60_000);
  return `${local.toISOString().slice(0, 19)}+08:00`;
}

/** Taipei `YYYY-MM-DD` and `HH:MM` for an instant. */
export function taipeiParts(instant: string): { date: string; time: string } | null {
  const ms = Date.parse(instant);
  if (Number.isNaN(ms)) return null;
  const iso = toTaipeiIso(new Date(ms));
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

export function minutesBetween(a: string, b: string): number | null {
  const x = Date.parse(a);
  const y = Date.parse(b);
  if (Number.isNaN(x) || Number.isNaN(y)) return null;
  return Math.round(Math.abs(x - y) / 60_000);
}

/** Same instant, tolerant of formatting (`Z` versus `+08:00`, milliseconds). */
export function sameInstant(a: string, b: string): boolean {
  const x = Date.parse(a);
  const y = Date.parse(b);
  return !Number.isNaN(x) && !Number.isNaN(y) && x === y;
}

/** Candidate window either side of the planned time (TYPE-01). */
export const CANDIDATE_WINDOW_MINUTES = 90;
/** A candidate within this many minutes of the planned time counts as a time match. */
export const TIME_MATCH_MINUTES = 5;

/**
 * `Final Synced From Typefully` holds the sync time plus a short hash of the exact
 * text that was synced: `2026-10-01T09:00:00+08:00 #1a2b3c4d`. The hash is the
 * baseline that tells a later sync whether `Final Content` was edited in the Sheet
 * after the last sync (TYPE-05, PUB-03). A legacy value with no hash has no
 * baseline, and the services treat that conservatively.
 */
const SYNC_STAMP = /^(\S+)(?:\s+#([0-9a-f]{8}))?$/;

export type SyncStamp = { at: string; textHash: string | null };

export function parseSyncStamp(cell: string): SyncStamp | null {
  const text = cell.trim();
  if (!text) return null;
  const m = SYNC_STAMP.exec(text);
  if (!m || Number.isNaN(Date.parse(m[1]!))) return null;
  return { at: m[1]!, textHash: m[2] ?? null };
}

export function finalTextHash(text: string): string {
  return shortHash(`final:${text}`);
}

export function formatSyncStamp(at: Date, syncedText: string): string {
  return `${toTaipeiIso(at)} #${finalTextHash(syncedText)}`;
}

/** The Sheet's working copy for a platform: `Chinese Content` for Threads, `Content` otherwise. */
export function workingCopy(post: ScheduledPost, platform: Platform): string {
  return platform === 'Threads' ? post.chineseContent : post.content;
}

/** Sheet cells hold numbers as text; blank stays blank, zero stays zero (PUB-02). */
export function metricCell(value: number | undefined): string | undefined {
  return value === undefined || !Number.isFinite(value) ? undefined : String(value);
}
