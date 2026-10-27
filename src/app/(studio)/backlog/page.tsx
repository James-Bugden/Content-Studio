import type { Metadata } from 'next';
import { getServices } from '@/application/container';
import { loadBacklogOptions, loadBacklogGroups, type BacklogFilters } from '@/application/backlog';
import { ErrorState, PageHeader, StateView } from '@/components';
import { BacklogGroupTable } from '@/components/backlog/backlog-group-table';
import { LibraryBacklogExplorer } from '@/components/backlog/library-backlog-explorer';
import { LibraryBacklogTable } from '@/components/backlog/library-backlog-table';
import { StaleBacklogBanner } from '@/components/backlog/stale-backlog-banner';
import { PanelHost } from '@/components/panel/panel-host';
import { FilterBar } from '@/components/filter-bar';
import { SortDirectionToggle } from '@/components/backlog/sort-direction-toggle';
import { PLATFORMS, type Platform } from '@/domain/enums';
import { isAppError, type ErrorCode } from '@/domain/errors';
import { libraryBacklogTotals, libraryBacklogView } from '@/domain/library-backlog';
import { BacklogTotalsStrip } from '@/components/backlog/backlog-totals';
import { BACKLOG_DIRECTIONS, BACKLOG_GROUPS, BACKLOG_SORTS, type BacklogDirection, type BacklogGroup, type BacklogSort } from '@/domain/library-backlog';
import { backlogReadiness } from '@/application/backlog-readiness';
import { requireActor } from '@/lib/auth';
import { timed } from '@/observability/events';

const BACKLOG_SORT_OPTIONS = [
  { value: 'source', label: 'Source' }, { value: 'platform', label: 'Platform' }, { value: 'pesto', label: 'PESTO' },
  { value: 'hookTemplate', label: 'Hook template' }, { value: 'hook', label: 'Hook' }, { value: 'status', label: 'Status' },
  { value: 'approved', label: 'Approved' },
];
const BACKLOG_GROUP_OPTIONS = [
  { value: 'source', label: 'Source' }, { value: 'platform', label: 'Platform' }, { value: 'pesto', label: 'PESTO' }, { value: 'status', label: 'Status' },
];

export const metadata: Metadata = { title: 'Backlog | Content Studio' };
export const dynamic = 'force-dynamic';

type Params = Record<string, string | string[] | undefined>;
function one(params: Params, key: string): string | undefined { return typeof params[key] === 'string' ? params[key] : undefined; }
function platform(params: Params): Platform | undefined {
  const raw = one(params, 'platform');
  return raw && (PLATFORMS as readonly string[]).includes(raw) ? raw as Platform : undefined;
}
function sort(params: Params): BacklogSort | undefined {
  const raw = one(params, 'sort');
  return raw && (BACKLOG_SORTS as readonly string[]).includes(raw) ? raw as BacklogSort : undefined;
}
function direction(params: Params): BacklogDirection | undefined {
  const raw = one(params, 'dir');
  return raw && (BACKLOG_DIRECTIONS as readonly string[]).includes(raw) ? raw as BacklogDirection : undefined;
}
function grouping(params: Params): BacklogGroup | undefined {
  const raw = one(params, 'group');
  return raw && (BACKLOG_GROUPS as readonly string[]).includes(raw) ? raw as BacklogGroup : undefined;
}
function safeBacklogErrorCode(error: unknown): ErrorCode {
  return isAppError(error) ? error.code : 'UNKNOWN';
}

export default async function BacklogPage({ searchParams }: { searchParams: Promise<Params> }) {
  const actor = await requireActor('viewer');
  const { repo } = getServices();
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item);
  }
  const retryHref = query.size ? `/backlog?${query}` : '/backlog';
  const ideas = one(params, 'view') === 'ideas';
  if (!ideas) {
    let stale = false;
    let readAt = 0;
    let library: Awaited<ReturnType<typeof repo.listLibrary>>;
    let queue: Awaited<ReturnType<typeof repo.listReadyQueue>> | null;
    let schedule: Awaited<ReturnType<typeof repo.listSchedule>> | null;
    try {
      [library, queue, schedule] = await timed({ name: 'backlog.load', adapter: 'app', facts: { view: 'posts' } }, () => Promise.all([
        repo.listLibrary(), repo.listReadyQueue().catch(() => null), repo.listSchedule().catch(() => null),
      ]));
    } catch (error) {
      const cached = repo.lastGoodLibrary?.(error);
      if (!cached) return <><PageHeader title="Backlog" description="Posts from Content Library." /><ErrorState code={safeBacklogErrorCode(error)} action={<a href={retryHref} className="inline-flex min-h-11 items-center font-semibold underline">Try again</a>} /></>;
      library = cached.rows;
      readAt = cached.readAt;
      queue = null;
      schedule = null;
      stale = true;
    }
    const readiness = backlogReadiness(library, queue, schedule);
    const requestedPage = Number(one(params, 'page'));
    const filters = {
      source: one(params, 'source'), platform: platform(params), pesto: one(params, 'pesto'),
      status: one(params, 'status'), sort: sort(params), dir: direction(params), group: grouping(params),
    };
    const view = libraryBacklogView(library, {
      ...filters, page: Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1,
    }, readiness);
    return (
      <>
        <PageHeader title="Backlog" description="Posts from Content Library. Filter, review and edit them here." />
        {stale ? <StaleBacklogBanner readAt={readAt} retryHref={retryHref} /> : null}
        <BacklogTotalsStrip key={stale ? 'stale' : 'live'} initial={libraryBacklogTotals(library)} readOnly={stale} />
        <nav aria-label="Backlog views" className="mb-4 flex gap-3 text-sm"><span aria-current="page" className="font-semibold">Posts ({library.length})</span><a className="text-primary underline" href="/backlog?view=ideas">Ideas in Content Queue</a></nav>
        <FilterBar filters={[
          { key: 'source', label: 'Source', options: view.sources.map((s) => ({ value: s, label: s })) },
          { key: 'platform', label: 'Platform', control: 'chips', options: view.platforms.map((p) => ({ value: p, label: p })) },
          { key: 'pesto', label: 'PESTO', options: view.pestoOptions.map((s) => ({ value: s, label: s })) },
          { key: 'status', label: 'Status', options: view.statusOptions.map((s) => ({ value: s, label: s })) },
          { key: 'group', label: 'Group', allLabel: 'None', options: BACKLOG_GROUP_OPTIONS },
          { key: 'sort', label: 'Sort', allLabel: 'Sheet order (#)', options: BACKLOG_SORT_OPTIONS },
        ]} variant="toolbar" trailing={<SortDirectionToggle />} />
        {stale ? view.total === 0 ? <StateView kind={library.length ? 'no_match' : 'empty'} nextStep={library.length ? undefined : null} /> : <LibraryBacklogTable rows={view.rows} readOnly statuses={Object.fromEntries(readiness)} sort={filters.sort} dir={filters.dir} group={filters.group} groupTotals={view.groupTotals} /> : <LibraryBacklogExplorer
          initial={{ ok: true, rows: view.rows, statuses: Object.fromEntries(view.rows.map((r) => [r.value.libraryId, readiness.get(r.value.libraryId)!])), total: view.total, page: view.page, totalPages: view.totalPages, groupTotals: view.groupTotals }}
          filters={filters} canEdit={actor.role === 'owner'} pestoOptions={view.pestoOptions} emptyLibrary={library.length === 0} />}
        <PanelHost readOnly={stale} />
      </>
    );
  }

  // Ideas remain in Content Queue; read that tab once for rows and filters.
  let queue: Awaited<ReturnType<typeof repo.listQueue>>;
  try {
    queue = await repo.listQueue();
  } catch (error) {
    return <><PageHeader title="Backlog ideas" description="Ideas from the Content Queue Sheet, before they become posts." /><ErrorState code={safeBacklogErrorCode(error)} action={<a href={retryHref} className="inline-flex min-h-11 items-center font-semibold underline">Try again</a>} /></>;
  }
  const approvedRaw = one(params, 'approved');
  const filters: BacklogFilters = { source: one(params, 'source'), platform: platform(params), approved: approvedRaw === 'yes' ? true : approvedRaw === 'no' ? false : undefined };
  const [groups, options] = await Promise.all([loadBacklogGroups(repo, filters, queue), loadBacklogOptions(repo, queue)]);
  const total = groups.reduce((sum, g) => sum + g.total, 0);
  return (
    <>
      <PageHeader title="Backlog ideas" description="Ideas from the Content Queue Sheet, before they become posts." />
      <nav aria-label="Backlog views" className="mb-4 flex gap-3 text-sm"><a className="text-primary underline" href="/backlog">Content Library posts</a><span aria-current="page" className="font-semibold">Ideas ({queue.length})</span></nav>
      <FilterBar filters={[
        { key: 'source', label: 'Content Source', options: options.sources.map((s) => ({ value: s, label: s })) },
        { key: 'platform', label: 'Platform', control: 'chips', options: options.platforms.map((p) => ({ value: p, label: p })) },
        { key: 'approved', label: 'Approved', options: [{ value: 'yes', label: 'Approved' }, { value: 'no', label: 'Not yet approved' }] },
      ]} />
      {total === 0 ? <StateView kind={queue.length ? 'no_match' : 'empty'} detail={queue.length ? 'No ideas match these filters.' : 'The Content Queue is empty.'} nextStep={queue.length ? undefined : null} /> :
        <ul className="flex flex-col gap-3">{groups.map((group) => <li key={group.source}>
          <details key={`${group.source}-${filters.source ?? ''}-${filters.platform ?? ''}-${filters.approved ?? ''}`} open={Boolean(filters.source || filters.platform || filters.approved !== undefined)} className="group rounded-lg border border-line bg-card"><summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-2 px-4 py-2 text-sm marker:hidden [&::-webkit-details-marker]:hidden"><span aria-hidden="true" className="inline-block text-ink-soft transition-transform duration-150 group-open:rotate-90">▸</span><span className="font-semibold">{group.source}</span><span className="text-ink-soft">({group.total} {group.total === 1 ? 'idea' : 'ideas'})</span></summary>
            <BacklogGroupTable source={group.source} canEdit={actor.role === 'owner'} pestoOptions={options.pestoStages} hookTemplateOptions={options.hookTemplates} items={group.items.map((item) => ({ libraryId: item.libraryId, revision: item.revision, hook: item.hook, reviewStatus: item.reviewStatus, pesto: item.pesto, platform: item.platform, hookTemplate: item.hookTemplate, preview: item.draftContent.slice(0, 240) }))} />
          </details>
        </li>)}</ul>}
      <PanelHost />
    </>
  );
}
