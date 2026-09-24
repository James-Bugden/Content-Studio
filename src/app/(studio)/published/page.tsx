import type { Metadata } from 'next';
import { getServices } from '@/application/container';
import { today } from '@/application/schedule';
import { ErrorState, FilterBar, GuardedLink, PageHeader, StateView } from '@/components';
import { PublishedCard } from '@/components/published/published-card';
import { METRIC_KEYS, publishedDate, publishedSummary, type PlatformSummary, type PublishedSummary } from '@/domain/analytics';
import { PLATFORMS, type Platform } from '@/domain/enums';
import { isAppError } from '@/domain/errors';
import type { ScheduleRecord } from '@/domain/records';
import { plannedTaipeiIso } from '@/domain/typefully';
import {
  METRIC_LABELS,
  formatTaipei,
  isPublishedRow,
  parsePlatformFilter,
  parseRangePreset,
  publishedRowView,
  rangeFrom,
  type PublishedRowView,
} from '@/domain/typefully-view';
import { requireActor } from '@/lib/auth';

export const metadata: Metadata = { title: 'Published | Content Studio' };
export const dynamic = 'force-dynamic';

/** Wall-clock time for sync freshness; read once per request. */
function currentTime(): number {
  return Date.now();
}

const RANGE_LABEL: Record<string, string> = { '7d': 'Last 7 days', '30d': 'Last 30 days', '90d': 'Last 90 days' };

function rangeWords(s: PublishedSummary): string {
  if (!s.range.from && !s.range.to) return 'all time';
  if (s.range.from && !s.range.to) return `${s.range.from} onwards (Taipei dates)`;
  return `${s.range.from ?? 'the start'} to ${s.range.to ?? 'today'} (Taipei dates)`;
}

function SummaryTable({ s, range }: { s: PlatformSummary; range: string }) {
  const last = s.lastAnalyticsSyncAt ? `${formatTaipei(s.lastAnalyticsSyncAt) ?? s.lastAnalyticsSyncAt} Taipei` : 'never';
  return (
    <section aria-label={`${s.platform} totals`} className="rounded-lg border border-line bg-card p-4">
      <h3 className="font-semibold">{s.platform}</h3>
      <ul className="mt-1 text-sm">
        <li>Date range: {range}</li>
        <li>Rows included: {s.rowsIncluded}</li>
        <li>Last analytics sync: {last}</li>
        <li>Rows never analytics-synced: {s.rowsNeverAnalyticsSynced}</li>
        <li>Rows missing at least one metric: {s.rowsMissingAnyMetric}</li>
      </ul>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[18rem] text-left text-sm">
          <caption className="sr-only">{s.platform} metric totals with their denominators</caption>
          <thead>
            <tr>
              <th scope="col" className="py-1 pr-3">
                Metric
              </th>
              <th scope="col" className="py-1 pr-3">
                Total
              </th>
              <th scope="col" className="py-1 pr-3">
                Rows with a value
              </th>
              <th scope="col" className="py-1">
                Rows missing
              </th>
            </tr>
          </thead>
          <tbody>
            {METRIC_KEYS.map((k) => {
              const c = s.metrics[k];
              return (
                <tr key={k} className="border-t border-line" data-metric={k}>
                  <th scope="row" className="py-1 pr-3 font-medium whitespace-nowrap">
                    {METRIC_LABELS[k]}
                  </th>
                  <td className="py-1 pr-3 tabular-nums">{c.total === null ? 'No values' : c.total.toLocaleString('en-GB')}</td>
                  <td className="py-1 pr-3 tabular-nums">
                    {c.rowsWithValue} of {s.rowsIncluded}
                  </td>
                  <td className="py-1 tabular-nums">{c.rowsMissing}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * Published library and factual per-platform totals (CS-016). Built from the
 * Schedule rows on every load. X and Threads are separate sections and separate
 * totals (PUB-01); a blank metric is missing, not zero (PUB-02, PUB-05).
 * Filters are URL enums only.
 */
export default async function PublishedPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor('viewer');
  const sp = await searchParams;
  const platform = parsePlatformFilter(sp.platform);
  const preset = parseRangePreset(sp.range);
  const from = rangeFrom(preset, today());
  const header = <PageHeader title="Published" description="Exact final copy, links and recorded metrics per platform. Times are Taipei." />;

  let schedule: ScheduleRecord[];
  try {
    schedule = await getServices().repo.listSchedule();
  } catch (error) {
    return (
      <>
        {header}
        <ErrorState code={isAppError(error) ? error.code : 'UNKNOWN'} />
      </>
    );
  }
  const now = currentTime();
  const summary = publishedSummary(
    schedule.map((r) => r.value),
    { ...(platform ? { platform } : {}), ...(from ? { from } : {}) },
  );
  const rows: PublishedRowView[] = schedule
    .filter((r) => isPublishedRow(r.value))
    .filter((r) => !platform || (r.value.platform?.ok && r.value.platform.value === platform))
    .filter((r) => {
      if (!from) return true;
      const d = publishedDate(r.value);
      return d !== null && d >= from;
    })
    .map((r) => publishedRowView(r.value, r.revision, now))
    .sort((a, b) => (b.publishedAt || b.contentId).localeCompare(a.publishedAt || a.contentId));
  const groups: { key: string; title: string; rows: PublishedRowView[] }[] = [
    ...PLATFORMS.filter((p: Platform) => !platform || p === platform).map((p) => ({ key: p, title: p, rows: rows.filter((r) => r.platform === p) })),
    { key: 'unknown', title: 'Platform not recognised', rows: rows.filter((r) => r.platform === null) },
  ].filter((g) => g.rows.length > 0);
  const range = rangeWords(summary);
  // Planned time has passed but Typefully has not reported publication: delayed, not published.
  const delayed = schedule
    .map((r) => r.value)
    .filter((v) => v.typefullyStatus.ok && (v.typefullyStatus.value === 'Scheduled' || v.typefullyStatus.value === 'Planned'))
    .filter((v) => !platform || (v.platform?.ok && v.platform.value === platform))
    .filter((v) => {
      const at = plannedTaipeiIso(v);
      return at !== null && Date.parse(at) < now;
    });

  return (
    <>
      {header}
      <div className="mt-4 flex flex-col gap-6">
        <FilterBar
          filters={[
            { key: 'platform', label: 'Platform', options: PLATFORMS.map((p) => ({ value: p, label: p })) },
            { key: 'range', label: 'Published', options: Object.entries(RANGE_LABEL).map(([value, label]) => ({ value, label })) },
          ]}
        />

        <section aria-labelledby="totals-h" className="flex flex-col gap-3">
          <h2 id="totals-h" className="text-lg font-semibold">
            Totals by platform
          </h2>
          <p className="text-sm" data-testid="totals-statement">
            Missing values are not counted as zero: each total covers only the rows that have a value, and the rows missing are listed next to it. X and Threads are never combined.
          </p>
          {summary.platforms.length === 0 ? (
            <StateView kind="empty" title="No published rows in this range" detail={`Date range: ${range}.`} nextStep={null} />
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {summary.platforms.map((s) => (
                <SummaryTable key={s.platform} s={s} range={range} />
              ))}
            </div>
          )}
          {summary.rowsExcludedUnrecognisedPlatform > 0 || summary.rowsExcludedNoDate > 0 ? (
            <p className="text-sm">
              Left out of the totals: {summary.rowsExcludedUnrecognisedPlatform} with an unrecognised platform, {summary.rowsExcludedNoDate} with no readable date.
            </p>
          ) : null}
        </section>

        {delayed.length > 0 ? (
          <section aria-labelledby="delayed-h" className="rounded-lg border border-line bg-card p-4 text-sm">
            <h2 id="delayed-h" className="font-semibold">
              ◐ Planned time passed, not published yet ({delayed.length})
            </h2>
            <p className="mt-1">These rows are not counted as published. Check them in Typefully, then sync.</p>
            <ul className="mt-2 list-disc pl-5">
              {delayed.map((v) => (
                <li key={v.contentId}>
                  <GuardedLink href={`/schedule/${encodeURIComponent(v.contentId)}`} className="font-mono underline">
                    {v.contentId}
                  </GuardedLink>{' '}
                  · {v.typefullyStatus.ok ? v.typefullyStatus.value : ''}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {groups.length === 0 ? (
          <StateView kind={platform || preset ? 'no_match' : 'empty'} title="Nothing published here yet" detail="No Schedule row has Typefully Status Published, a publish time or a post link for these filters." nextStep={platform || preset ? undefined : null} />
        ) : (
          groups.map((g) => (
            <section key={g.key} aria-labelledby={`g-${g.key}`} className="flex flex-col gap-3">
              <h2 id={`g-${g.key}`} className="text-lg font-semibold">
                {g.title} <span className="text-sm font-normal text-ink-soft">({g.rows.length})</span>
              </h2>
              <ul className="grid gap-3 lg:grid-cols-2">
                {g.rows.map((r) => (
                  <li key={r.contentId} className="min-w-0">
                    <PublishedCard row={r} canEdit={actor.role === 'owner'} />
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </>
  );
}
