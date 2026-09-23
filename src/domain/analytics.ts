import { PLATFORMS, type Platform } from './enums';
import type { ScheduledPost } from './records';
import { contentIdDate, taipeiParts } from './typefully';

/**
 * Published analytics summary (CS-016 PUB-01, PUB-02, PUB-05).
 *
 * Pure and factual: totals per platform with their denominators on show. A blank
 * metric is missing, not zero, so it is excluded from that metric's total and
 * counted as missing. X and Threads are always separate platforms; nothing here
 * combines them. No predictive score is computed.
 */
export const METRIC_KEYS = ['views', 'likes', 'reposts', 'replies', 'bookmarks', 'newFollowers'] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

export type MetricCoverage = {
  /** Sum over rows that have a value. Null when no included row has a value. */
  total: number | null;
  rowsWithValue: number;
  rowsMissing: number;
};

export type PlatformSummary = {
  platform: Platform;
  rowsIncluded: number;
  metrics: Record<MetricKey, MetricCoverage>;
  /** Rows with at least one blank metric. */
  rowsMissingAnyMetric: number;
  /** Rows with every metric blank. */
  rowsWithNoMetrics: number;
  rowsNeverAnalyticsSynced: number;
  /** Newest and oldest `Analytics Synced At` among included rows, as recorded. */
  lastAnalyticsSyncAt: string | null;
  oldestAnalyticsSyncAt: string | null;
};

export type PublishedSummary = {
  range: { from: string | null; to: string | null };
  platformFilter: Platform | null;
  platforms: PlatformSummary[];
  /** Published rows whose platform cell is blank or unrecognised; never guessed. */
  rowsExcludedUnrecognisedPlatform: number;
  /** Published rows with no usable date, excluded only when a range is set. */
  rowsExcludedNoDate: number;
};

function isPublished(p: ScheduledPost): boolean {
  return p.typefullyStatus.ok && p.typefullyStatus.value === 'Published';
}

/** Taipei publication date: `Published At` when readable, else the Content ID date. */
export function publishedDate(p: ScheduledPost): string | null {
  const parts = p.publishedAt ? taipeiParts(p.publishedAt) : null;
  return parts?.date ?? contentIdDate(p.contentId);
}

function emptyCoverage(): Record<MetricKey, MetricCoverage> {
  return Object.fromEntries(METRIC_KEYS.map((k) => [k, { total: null, rowsWithValue: 0, rowsMissing: 0 }])) as Record<MetricKey, MetricCoverage>;
}

export function publishedSummary(
  schedule: readonly ScheduledPost[],
  options: { platform?: Platform; from?: string; to?: string } = {},
): PublishedSummary {
  const byPlatform = new Map<Platform, PlatformSummary>();
  let unrecognised = 0;
  let noDate = 0;
  const ranged = Boolean(options.from || options.to);

  for (const p of schedule) {
    if (!isPublished(p)) continue;
    if (!p.platform?.ok) {
      unrecognised += 1;
      continue;
    }
    const platform = p.platform.value;
    if (options.platform && platform !== options.platform) continue;
    if (ranged) {
      const date = publishedDate(p);
      if (!date) {
        noDate += 1;
        continue;
      }
      if (options.from && date < options.from) continue;
      if (options.to && date > options.to) continue;
    }
    let s = byPlatform.get(platform);
    if (!s) {
      s = {
        platform,
        rowsIncluded: 0,
        metrics: emptyCoverage(),
        rowsMissingAnyMetric: 0,
        rowsWithNoMetrics: 0,
        rowsNeverAnalyticsSynced: 0,
        lastAnalyticsSyncAt: null,
        oldestAnalyticsSyncAt: null,
      };
      byPlatform.set(platform, s);
    }
    s.rowsIncluded += 1;
    let missing = 0;
    for (const key of METRIC_KEYS) {
      const value = p.metrics[key];
      const c = s.metrics[key];
      if (value === null) {
        c.rowsMissing += 1;
        missing += 1;
      } else {
        c.rowsWithValue += 1;
        c.total = (c.total ?? 0) + value;
      }
    }
    if (missing > 0) s.rowsMissingAnyMetric += 1;
    if (missing === METRIC_KEYS.length) s.rowsWithNoMetrics += 1;
    const synced = p.analyticsSyncedAt && !Number.isNaN(Date.parse(p.analyticsSyncedAt)) ? p.analyticsSyncedAt : null;
    if (!synced) s.rowsNeverAnalyticsSynced += 1;
    else {
      if (!s.lastAnalyticsSyncAt || Date.parse(synced) > Date.parse(s.lastAnalyticsSyncAt)) s.lastAnalyticsSyncAt = synced;
      if (!s.oldestAnalyticsSyncAt || Date.parse(synced) < Date.parse(s.oldestAnalyticsSyncAt)) s.oldestAnalyticsSyncAt = synced;
    }
  }

  return {
    range: { from: options.from ?? null, to: options.to ?? null },
    platformFilter: options.platform ?? null,
    platforms: PLATFORMS.flatMap((pl) => (byPlatform.has(pl) ? [byPlatform.get(pl)!] : [])),
    rowsExcludedUnrecognisedPlatform: unrecognised,
    rowsExcludedNoDate: noDate,
  };
}
