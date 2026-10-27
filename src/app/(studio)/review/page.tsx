import type { Metadata } from 'next';
import type { FilterDef } from '@/components/filter-bar';
import { getServices } from '@/application/container';
import { capabilities } from '@/application/capabilities';
import { LEGACY_LANES, loadReviewQueue, parseReviewFilters, type ReviewQueue } from '@/application/review';
import { CapabilityBanner, ErrorState, FilterBar, GuardedLink, PageHeader, StateView } from '@/components';
import { BacklogTable } from '@/components/review/backlog-table';
import { ReviewCard } from '@/components/review/review-card';
import { BACKLOG_TABS, TAB_LABEL } from '@/domain/backlog';
import { COPYRIGHT_QA, DUPLICATE_QA, PLATFORMS, REVIEW_STATUSES } from '@/domain/enums';
import { isAppError } from '@/domain/errors';
import type { QueueSummaryRow } from '@/domain/records';
import { requireActor } from '@/lib/auth';

export const metadata: Metadata = { title: 'Posts | Content Studio' };
export const dynamic = 'force-dynamic';

const LEGACY_LABEL: Record<(typeof LEGACY_LANES)[number], string> = {
  clean: 'Ready to review',
  copyright: 'Copyright rework',
  duplicate: 'Duplicate check',
  approved: 'Approved',
};

const QA_LABEL: Record<string, string> = { Unchecked: 'Not checked', PASS: 'Cleared / no flag' };

/**
 * Posts (CS-007, UX redesign; nav label "Posts"). A Sheet-like backlog: tabs
 * with counts, one row per post with a pill per step, and the review cards (with
 * their per-item actions) one toggle away (`?layout=cards`). A fresh, bounded
 * read of Content Library on every request. Empty queue, no filter match and provider failure are three different
 * screens (REV-05): a failed read never renders as an empty list.
 */
export default async function ReviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor('viewer');
  const params = await searchParams;
  const filters = parseReviewFilters(params);
  const { repo } = getServices();

  let queue: ReviewQueue;
  let summary: QueueSummaryRow[] | null;
  try {
    [queue, summary] = await Promise.all([loadReviewQueue(repo, filters), repo.queueSummary().catch(() => null)]);
  } catch (error) {
    return (
      <>
        <PageHeader title="Posts" description="Check each post, then approve it or ask for changes." />
        <ErrorState code={isAppError(error) ? error.code : 'UNKNOWN'} />
      </>
    );
  }

  const lane = filters.lane ?? 'all';
  const legacy = (LEGACY_LANES as readonly string[]).includes(lane) ? (lane as (typeof LEGACY_LANES)[number]) : null;
  const layout = params.layout === 'cards' ? 'cards' : 'table';
  const hrefWith = (change: Record<string, string | null>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (typeof v === 'string' && !(k in change) && k !== 'post' && k !== 'slot' && !(k === 'layout' && v !== 'cards')) next.set(k, v);
    for (const [k, v] of Object.entries(change)) if (v) next.set(k, v);
    const q = next.toString();
    return q ? `/review?${q}` : '/review';
  };

  const filterDefs: FilterDef[] = [
    { key: 'target', label: 'Target platform', control: 'chips', options: PLATFORMS.map((p) => ({ value: p, label: p })) },
    { key: 'review', label: 'Review status', control: 'chips', options: REVIEW_STATUSES.map((s) => ({ value: s, label: s === 'Pending' ? 'Not reviewed' : s })) },
    { key: 'src', label: 'Source', options: queue.sources.map((s) => ({ value: s.key, label: s.label })) },
    { key: 'from', label: 'Source platform', options: PLATFORMS.map((p) => ({ value: p, label: p })) },
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
  ];
  const clearHref = hrefWith(Object.fromEntries(['lane', 'page', ...filterDefs.map(f => f.key)].map(key => [key, null])));
  const resultCount = queue.totalUnfiltered === 0
    ? 'The Content Library is empty'
    : queue.total === 0
    ? `None of the ${queue.totalUnfiltered} Library rows match these filters.`
    : `Showing ${(queue.page - 1) * 25 + 1} to ${Math.min(queue.page * 25, queue.total)} of ${queue.total}${queue.total !== queue.totalUnfiltered ? ` (filtered from ${queue.totalUnfiltered})` : ''}`;

  return (
    <>
      <PageHeader
        title="Posts"
        description="Every post and where it is. Open a post to do its next step; nothing is approved in bulk."
        actions={
          <nav aria-label="Layout" className="inline-flex rounded-md border border-line bg-card p-0.5">
            {(['table', 'cards'] as const).map((l) => (
              <GuardedLink
                key={l}
                href={hrefWith({ layout: l === 'table' ? null : l, page: null })}
                aria-current={l === layout ? 'page' : undefined}
                className={`inline-flex min-h-11 items-center rounded px-3 text-sm ${l === layout ? 'bg-primary-soft font-semibold text-primary' : 'text-ink-soft hover:text-ink'}`}
              >
                {l === 'table' ? 'Table' : 'Cards'}
              </GuardedLink>
            ))}
          </nav>
        }
      />
      <div className="mt-4 flex flex-col gap-4">
        <CapabilityBanner capabilities={capabilities()} />

        {summary && summary.length > 0 ? (
          <details className="group rounded-lg border border-line bg-card px-4">
            <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-1 py-2 text-sm marker:hidden [&::-webkit-details-marker]:hidden">
              <span aria-hidden="true" className="inline-block text-ink-soft transition-transform duration-150 group-open:rotate-90">
                ▸
              </span>
              <span className="font-semibold">Sources</span>
              <span className="text-ink-soft">
                ({summary.length} {summary.length === 1 ? 'source' : 'sources'}, from Content Queue Summary)
              </span>
            </summary>
            <ul className="grid gap-2 pb-3 sm:grid-cols-2">
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
          </details>
        ) : null}

        <nav aria-label="Post tabs">
          <ul className="flex flex-wrap gap-1.5 border-b border-line pb-2">
            {BACKLOG_TABS.map((l) => (
              <li key={l}>
                <GuardedLink
                  href={hrefWith({ lane: l === 'all' ? null : l, page: null })}
                  aria-current={l === lane ? 'page' : undefined}
                  className={`inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm ${
                    l === lane ? 'bg-primary-soft font-semibold text-primary underline decoration-2 underline-offset-4' : 'text-ink-soft hover:bg-card hover:text-ink'
                  }`}
                >
                  {TAB_LABEL[l]}
                  <span className="min-w-6 rounded-full border border-line bg-card px-1.5 text-center text-xs tabular-nums">{queue.laneCounts[l]}</span>
                </GuardedLink>
              </li>
            ))}
          </ul>
          {legacy ? (
            <p className="mt-2 text-sm text-ink-soft">
              Showing the {LEGACY_LABEL[legacy].toLowerCase()} list ({queue.laneCounts[legacy]}).{' '}
              <GuardedLink href={hrefWith({ lane: null, page: null })} className="underline">
                Show all posts
              </GuardedLink>
            </p>
          ) : null}
        </nav>

        <FilterBar announcement={resultCount} clearKeys={['lane']} hideClear={queue.total === 0 && queue.totalUnfiltered > 0} variant="toolbar" disclosureKeys={['src', 'from', 'copyright', 'duplicate', 'queue']} filters={filterDefs} />

        {queue.scheduleUnavailable ? (
          <StateView
            kind="provider_error"
            title="Content Schedule could not be read"
            detail="Screenshot reuse cannot be confirmed, so screenshot items stay blocked until it can."
            nextStep="Reload in a moment."
          />
        ) : null}

        {queue.totalUnfiltered === 0 ? (
          <StateView announce={false} kind="empty" title="The Content Library is empty" detail="There are no rows to review. New drafts appear here after they are added to the Sheet." nextStep={null} />
        ) : queue.total === 0 ? (
          <StateView
            kind="no_match"
            announce={false}
            detail={resultCount}
            action={<GuardedLink href={clearHref} className="underline">Clear all filters</GuardedLink>}
          />
        ) : (
          <>
            <p className="text-sm text-ink-soft">
              {resultCount}
            </p>
            {layout === 'cards' ? (
              <ol className="flex flex-col gap-4">
                {queue.cards.map((card) => (
                  <li key={`${card.libraryId}-${card.revision}`}>
                    <ReviewCard initial={card} canEdit={actor.role === 'owner'} />
                  </li>
                ))}
              </ol>
            ) : (
              <BacklogTable cards={queue.cards} />
            )}
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
