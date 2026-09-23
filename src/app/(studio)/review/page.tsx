import type { Metadata } from 'next';
import { getServices } from '@/application/container';
import { capabilities } from '@/application/capabilities';
import { LANES, loadReviewQueue, parseReviewFilters, type Lane, type ReviewQueue } from '@/application/review';
import { CapabilityBanner, ErrorState, FilterBar, GuardedLink, PageHeader, StateView } from '@/components';
import { ReviewCard } from '@/components/review/review-card';
import { COPYRIGHT_QA, DUPLICATE_QA, PLATFORMS, REVIEW_STATUSES } from '@/domain/enums';
import { isAppError } from '@/domain/errors';
import type { QueueSummaryRow } from '@/domain/records';
import { requireActor } from '@/lib/auth';

export const metadata: Metadata = { title: 'Review | Content Studio' };
export const dynamic = 'force-dynamic';

const LANE_LABEL: Record<Lane, string> = {
  all: 'All',
  clean: 'Ready to review',
  copyright: 'Copyright rework',
  duplicate: 'Duplicate check',
  blocked: 'Other blockers',
  approved: 'Approved',
};

const QA_LABEL: Record<string, string> = { Unchecked: 'Not checked', PASS: 'Cleared / no flag' };

/**
 * Review Queue (CS-007). A fresh, bounded read of Content Library on every
 * request. Empty queue, no filter match and provider failure are three different
 * screens (REV-05): a failed read never renders as an empty list.
 */
export default async function ReviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor('viewer');
  const params = await searchParams;
  const filters = parseReviewFilters(params);
  const { repo } = getServices();

  let queue: ReviewQueue;
  try {
    queue = await loadReviewQueue(repo, filters);
  } catch (error) {
    return (
      <>
        <PageHeader title="Review queue" description="Check drafts, hooks and QA flags, then approve or request changes." />
        <ErrorState code={isAppError(error) ? error.code : 'UNKNOWN'} />
      </>
    );
  }
  let summary: QueueSummaryRow[] | null = null;
  try {
    summary = await repo.queueSummary();
  } catch {
    summary = null;
  }

  const lane = filters.lane ?? 'all';
  const hrefWith = (change: Record<string, string | null>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (typeof v === 'string' && !(k in change)) next.set(k, v);
    for (const [k, v] of Object.entries(change)) if (v) next.set(k, v);
    const q = next.toString();
    return q ? `/review?${q}` : '/review';
  };

  return (
    <>
      <PageHeader title="Review queue" description="Check drafts, hooks and QA flags, then approve or request changes. One item at a time; nothing is approved in bulk." />
      <div className="mt-4 flex flex-col gap-4">
        <CapabilityBanner capabilities={capabilities()} />

        {summary && summary.length > 0 ? (
          <section aria-labelledby="summary-h" className="rounded-lg border border-line bg-card p-4">
            <h2 id="summary-h" className="text-sm font-semibold">
              Sources (from Content Queue Summary)
            </h2>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2">
              {summary.map((s) => (
                <li key={s.source} className="min-w-0 text-sm">
                  <span className="font-medium">{s.source}</span>
                  <span className="text-ink-soft">
                    {' '}
                    {Object.entries(s.counts)
                      .map(([k, v]) => `${k} ${v === null ? 'n/a' : v}`)
                      .join(' · ')}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <nav aria-label="Review lanes">
          <ul className="flex flex-wrap gap-2">
            {LANES.map((l) => (
              <li key={l}>
                <GuardedLink
                  href={hrefWith({ lane: l === 'all' ? null : l, page: null })}
                  aria-current={l === lane ? 'page' : undefined}
                  className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm ${
                    l === lane ? 'border-ink bg-focal font-semibold' : 'border-line bg-card hover:border-ink'
                  }`}
                >
                  {LANE_LABEL[l]}
                  <span className="rounded-full bg-paper px-2 text-xs tabular-nums">{queue.laneCounts[l]}</span>
                </GuardedLink>
              </li>
            ))}
          </ul>
        </nav>

        <FilterBar
          filters={[
            { key: 'src', label: 'Source', options: queue.sources.map((s) => ({ value: s.key, label: s.label })) },
            { key: 'target', label: 'Target platform', options: PLATFORMS.map((p) => ({ value: p, label: p })) },
            { key: 'from', label: 'Source platform', options: PLATFORMS.map((p) => ({ value: p, label: p })) },
            { key: 'review', label: 'Review status', options: REVIEW_STATUSES.map((s) => ({ value: s, label: s === 'Pending' ? 'Not reviewed' : s })) },
            { key: 'copyright', label: 'Copyright QA', options: COPYRIGHT_QA.map((s) => ({ value: s, label: QA_LABEL[s] ?? s })) },
            { key: 'duplicate', label: 'Duplicate QA', options: DUPLICATE_QA.map((s) => ({ value: s, label: QA_LABEL[s] ?? s })) },
            {
              key: 'queue',
              label: 'Queue',
              options: [
                { value: 'queued', label: 'Queued' },
                { value: 'not_queued', label: 'Not queued' },
              ],
            },
          ]}
        />

        {queue.scheduleUnavailable ? (
          <StateView
            kind="provider_error"
            title="Content Schedule could not be read"
            detail="Screenshot reuse cannot be confirmed, so screenshot items stay blocked until it can."
            nextStep="Reload in a moment."
          />
        ) : null}

        {queue.totalUnfiltered === 0 ? (
          <StateView kind="empty" title="The Content Library is empty" detail="There are no rows to review. New drafts appear here after they are added to the Sheet." nextStep={null} />
        ) : queue.total === 0 ? (
          <StateView
            kind="no_match"
            detail={`None of the ${queue.totalUnfiltered} Library rows match these filters.`}
            action={
              <GuardedLink href="/review" className="text-sm underline">
                Clear all filters
              </GuardedLink>
            }
          />
        ) : (
          <>
            <p className="text-sm text-ink-soft" aria-live="polite">
              Showing {(queue.page - 1) * 25 + 1} to {Math.min(queue.page * 25, queue.total)} of {queue.total}
              {queue.total !== queue.totalUnfiltered ? ` (filtered from ${queue.totalUnfiltered})` : ''}
            </p>
            <ol className="flex flex-col gap-4">
              {queue.cards.map((card) => (
                <li key={`${card.libraryId}-${card.revision}`}>
                  <ReviewCard initial={card} canEdit={actor.role === 'owner'} />
                </li>
              ))}
            </ol>
            {queue.pages > 1 ? (
              <nav aria-label="Pages" className="flex items-center justify-between gap-2 text-sm">
                {queue.page > 1 ? (
                  <GuardedLink href={hrefWith({ page: String(queue.page - 1) })} className="underline">
                    Previous page
                  </GuardedLink>
                ) : (
                  <span />
                )}
                <span>
                  Page {queue.page} of {queue.pages}
                </span>
                {queue.page < queue.pages ? (
                  <GuardedLink href={hrefWith({ page: String(queue.page + 1) })} className="underline">
                    Next page
                  </GuardedLink>
                ) : (
                  <span />
                )}
              </nav>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}
