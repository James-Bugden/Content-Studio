import type { Capability } from './capability';
import type { Platform, TypefullyStatus } from './enums';
import type { ErrorCode } from './errors';
import type { ZhAdaptationState } from './gates';
import type { ScheduledPost } from './records';
import { METRIC_KEYS, type MetricKey } from './analytics';
import { finalTextHash, parseSyncStamp, taipeiParts } from './typefully';

/**
 * Client-safe views of Typefully reconciliation and published rows (CS-015/016).
 *
 * Pure types and helpers only, so client components can render them without
 * importing application or integration code. Nothing here carries a raw provider
 * payload: only the text, times, statuses and discriminators a person needs to
 * decide, taken from the Sheet row and the reconciled Typefully draft.
 */

/** Sheet copy versus Typefully copy for one linked row. */
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

export type CandidateView = CandidateDiscriminators & { text: string };

export type LinkedDraftView = {
  draftId: string;
  status: TypefullyStatus;
  platforms: Platform[];
  scheduledAt: string | null;
  updatedAt: string;
  publishedAt: string | null;
  url: string | null;
};

/** The five distinct reconciliation states (TYPE-01), plus an unusable row. */
export type TypefullyPanelView =
  | { kind: 'linked'; draft: LinkedDraftView; comparison: CopyComparison; platformMismatch: boolean }
  | { kind: 'single_match'; row: RowDiscriminators; candidate: CandidateView }
  | { kind: 'ambiguous'; row: RowDiscriminators; candidates: CandidateView[] }
  | { kind: 'no_match'; row: RowDiscriminators; searched: boolean }
  | { kind: 'invalid_row'; reason: 'platform_unrecognised' }
  | { kind: 'provider_error'; provider: 'sheet' | 'typefully'; code: ErrorCode };

export type ScheduleRowFacts = {
  contentId: string;
  parentContentId: string;
  platform: Platform | null;
  platformRaw: string;
  slot: string;
  displayDate: string;
  isoDate: string | null;
  publishTime: string;
  plannedAt: string | null;
  stage: string;
  typefullyStatus: string;
  draftId: string;
  libraryId: string | null;
  visual: { source: string; version: string; imageStatus: string };
  /** Threads rows only: freshness of the zh-TW adaptation of the parent X row. */
  zh: { state: ZhAdaptationState; xContentId: string } | null;
  revision: string;
};

export type TypefullyDetailView = { row: ScheduleRowFacts; panel: TypefullyPanelView; capability: Capability };

// ------------------------------------------------------------------ published (CS-016)

export const METRIC_LABELS: Record<MetricKey, string> = {
  views: 'Views',
  likes: 'Likes',
  reposts: 'Reposts',
  replies: 'Replies',
  bookmarks: 'Bookmarks',
  newFollowers: 'New followers',
};

/** Words for a blank metric: missing is not zero (PUB-02). */
export const METRIC_UNAVAILABLE = 'Not available from Typefully';

/** A sync older than this is stale (matches the reconciliation threshold). */
export const STALE_SYNC_MS = 48 * 60 * 60 * 1000;

export type SyncFreshness = { at: string | null; state: 'fresh' | 'stale' | 'never' | 'unreadable' };

export function syncFreshness(cell: string, nowMs: number): SyncFreshness {
  const text = cell.trim();
  if (!text) return { at: null, state: 'never' };
  const stamp = parseSyncStamp(text);
  const at = stamp?.at ?? text;
  const ms = Date.parse(at);
  if (Number.isNaN(ms)) return { at: text, state: 'unreadable' };
  return { at, state: nowMs - ms > STALE_SYNC_MS ? 'stale' : 'fresh' };
}

/** `1 Oct 2026, 08:00` in Taipei time, or null when unreadable. */
export function formatTaipei(instant: string): string | null {
  const parts = taipeiParts(instant);
  if (!parts) return null;
  const [y, m, d] = parts.date.split('-').map(Number) as [number, number, number];
  const month = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
  return `${d} ${month} ${y}, ${parts.time}`;
}

export type PublishedRowView = {
  contentId: string;
  parentContentId: string;
  platform: Platform | null;
  platformRaw: string;
  typefullyStatus: string;
  draftId: string;
  finalContent: string;
  visualVersion: string;
  publishedAt: string;
  publishedAtTaipei: string | null;
  postLink: string;
  finalSync: SyncFreshness;
  analyticsSync: SyncFreshness;
  metrics: { key: MetricKey; label: string; value: number | null }[];
  /** Disagreements visible from the Sheet alone; shown for reconciliation, never corrected (PUB-04). */
  problems: string[];
  revision: string;
};

/** Rows the Published library lists: status Published, or a recorded publish time or post link. */
export function isPublishedRow(p: ScheduledPost): boolean {
  const published = p.typefullyStatus.ok && p.typefullyStatus.value === 'Published';
  return published || p.publishedAt.trim() !== '' || p.postLink.trim() !== '';
}

export function publishedRowView(p: ScheduledPost, revision: string, nowMs: number): PublishedRowView {
  const status = p.typefullyStatus.ok ? p.typefullyStatus.value : `Unrecognised (${p.typefullyStatus.raw})`;
  const problems: string[] = [];
  const published = p.typefullyStatus.ok && p.typefullyStatus.value === 'Published';
  if (!published && (p.publishedAt.trim() || p.postLink.trim())) {
    problems.push(`Typefully Status is ${status}, but a publish time or post link is recorded.`);
  }
  if (published && !p.postLink.trim()) problems.push('Published, but no post link is recorded.');
  if (published && !p.publishedAt.trim()) problems.push('Published, but no publish time is recorded.');
  if (p.publishedAt.trim() && Number.isNaN(Date.parse(p.publishedAt))) problems.push('Published At is not a readable time.');
  if (!p.platform?.ok) problems.push('Platform is blank or not recognised, so this row is left out of the totals.');
  return {
    contentId: p.contentId,
    parentContentId: p.parentContentId,
    platform: p.platform?.ok ? p.platform.value : null,
    platformRaw: p.platform ? (p.platform.ok ? p.platform.value : p.platform.raw) : '',
    typefullyStatus: status,
    draftId: p.typefullyDraftId,
    finalContent: p.finalContent,
    visualVersion: p.visual.version,
    publishedAt: p.publishedAt,
    publishedAtTaipei: p.publishedAt ? formatTaipei(p.publishedAt) : null,
    postLink: p.postLink,
    finalSync: syncFreshness(p.finalSyncedAt, nowMs),
    analyticsSync: syncFreshness(p.analyticsSyncedAt, nowMs),
    metrics: METRIC_KEYS.map((key) => ({ key, label: METRIC_LABELS[key], value: p.metrics[key] })),
    problems,
    revision,
  };
}

// ------------------------------------------------------------------ published filters (URL enums only)

export const PLATFORM_FILTERS = ['X', 'Threads', 'LinkedIn'] as const;
export const RANGE_PRESETS = ['7d', '30d', '90d'] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

export function parsePlatformFilter(value: unknown): Platform | null {
  return typeof value === 'string' && (PLATFORM_FILTERS as readonly string[]).includes(value) ? (value as Platform) : null;
}

export function parseRangePreset(value: unknown): RangePreset | null {
  return typeof value === 'string' && (RANGE_PRESETS as readonly string[]).includes(value) ? (value as RangePreset) : null;
}

/** `from` date for a preset counted back from Taipei today; null means all time. */
export function rangeFrom(preset: RangePreset | null, today: string): string | null {
  if (!preset) return null;
  const days = preset === '7d' ? 7 : preset === '30d' ? 30 : 90;
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
}

// ------------------------------------------------------------------ reconciliation helper

/**
 * `Final Content` was edited in the Sheet after the last Typefully sync: the sync
 * stamp carries the hash of the synced text and the cell no longer matches it.
 * Null when there is no hashed stamp to compare with.
 */
export function finalEditedSinceSync(p: Pick<ScheduledPost, 'finalContent' | 'finalSyncedAt'>): boolean | null {
  const stamp = parseSyncStamp(p.finalSyncedAt);
  if (!stamp?.textHash) return null;
  return finalTextHash(p.finalContent) !== stamp.textHash;
}
