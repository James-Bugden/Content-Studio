import type { Metadata } from 'next';
import { getServices } from '@/application/container';
import { loadBacklogOptions, loadBacklogGroups, type BacklogFilters } from '@/application/backlog';
import { ErrorState, PageHeader, StateView } from '@/components';
import { BacklogGroupTable } from '@/components/backlog/backlog-group-table';
import { LibraryBacklogExplorer } from '@/components/backlog/library-backlog-explorer';
import { FilterBar } from '@/components/filter-bar';
import { PLATFORMS, type Platform } from '@/domain/enums';
import { ERROR_CODES, isAppError, type ErrorCode } from '@/domain/errors';
import { libraryBacklogView } from '@/domain/library-backlog';
import { BACKLOG_SORTS, type BacklogSort } from '@/domain/library-backlog';
import { backlogReadiness } from '@/application/backlog-readiness';
import { requireActor } from '@/lib/auth';
import { timed } from '@/observability/events';

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
function pageHref(params: Params, page: number): string {
  const query = new URLSearchParams();
  if (one(params, 'source')) query.set('source', one(params, 'source')!);
  if (platform(params)) query.set('platform', platform(params)!);
  if (one(params, 'status')) query.set('status', one(params, 'status')!);
  if (sort(params)) query.set('sort', sort(params)!);
  query.set('page', String(page));
  return `/backlog?${query}`;
}

function safeBacklogErrorCode(error: unknown): ErrorCode {
  if (isAppError(error)) return error.code;
  // Next's separate server module graphs can lose Error prototype identity.
  // Accept only our closed, content-free code vocabulary across that boundary.
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
  return typeof code === 'string' && (ERROR_CODES as readonly string[]).includes(code) ? code as ErrorCode : 'UNKNOWN';
}

export default async function BacklogPage({ searchParams }: { searchParams: Promise<Params> }) {
  const actor = await requireActor('viewer');
  const { repo } = getServices();
  const params = await searchParams;
  const ideas = one(params, 'view') === 'ideas';
  if (!ideas) {
    let library: Awaited<ReturnType<typeof repo.listLibrary>>;
    let queue: Awaited<ReturnType<typeof repo.listReadyQueue>> | null;
    let schedule: Awaited<ReturnType<typeof repo.listSchedule>> | null;
    try {
      [library, queue, schedule] = await timed({ name: 'backlog.load', adapter: 'app', facts: { view: 'posts' } }, () => Promise.all([
        repo.listLibrary(), repo.listReadyQueue().catch(() => null), repo.listSchedule().catch(() => null),
      ]));
    } catch (error) {
      return <><PageHeader title="Backlog" description="Posts from Content Library." /><ErrorState code={safeBacklogErrorCode(error)} action={<a href="/backlog" className="font-semibold underline">Try again</a>} /></>;
    }
    const readiness = backlogReadiness(library, queue, schedule);
    const requestedPage = Number(one(params, 'page'));
    const view = libraryBacklogView(library, {
      source: one(params, 'source'), platform: platform(params),
      status: one(params, 'status'), sort: sort(params),
      page: Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1,
    }, readiness);
    return (
      <>
        <PageHeader title="Backlog" description="Posts from Content Library. Filter, review and edit them here." />
        <nav aria-label="Backlog views" className="mb-4 flex gap-3 text-sm"><span aria-current="page" className="font-semibold">Posts ({library.length})</span><a className="text-primary underline" href="/backlog?view=ideas">Ideas in Content Queue</a></nav>
        <FilterBar filters={[
          { key: 'source', label: 'Content Source', options: view.sources.map((s) => ({ value: s, label: s })) },
          { key: 'platform', label: 'Platform', options: view.platforms.map((p) => ({ value: p, label: p })) },
          { key: 'status', label: 'Status', options: view.statusOptions.map((s) => ({ value: s, label: s })) },
          { key: 'sort', label: 'Sort', allLabel: 'Sheet order', options: [
            { value: 'source', label: 'Source' }, { value: 'hook', label: 'Hook' }, { value: 'status', label: 'Status' },
          ] },
        ]} />
        <LibraryBacklogExplorer
          initial={{ ok: true, rows: view.rows, statuses: Object.fromEntries(view.rows.map((r) => [r.value.libraryId, readiness.get(r.value.libraryId)!])), total: view.total, page: view.page, totalPages: view.totalPages }}
          filters={{ source: one(params, 'source'), platform: platform(params), status: one(params, 'status'), sort: sort(params) }}
          previousHref={view.page > 1 ? pageHref(params, view.page - 1) : null}
          nextHref={view.page < view.totalPages ? pageHref(params, view.page + 1) : null} />
      </>
    );
  }

  // Ideas remain in Content Queue; read that tab once for rows and filters.
  const queue = await repo.listQueue();
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
        { key: 'platform', label: 'Platform', options: options.platforms.map((p) => ({ value: p, label: p })) },
        { key: 'approved', label: 'Approved', options: [{ value: 'yes', label: 'Approved' }, { value: 'no', label: 'Not yet approved' }] },
      ]} />
      {total === 0 ? <StateView kind="no_match" detail={queue.length ? 'No ideas match these filters.' : 'The Content Queue is empty.'} action={null} /> :
        <ul className="flex flex-col gap-3">{groups.map((group) => <li key={group.source}>
          <details className="group rounded-lg border border-line bg-card"><summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-2 px-4 py-2 text-sm marker:hidden [&::-webkit-details-marker]:hidden"><span aria-hidden="true" className="inline-block text-ink-soft transition-transform duration-150 group-open:rotate-90">▸</span><span className="font-semibold">{group.source}</span><span className="text-ink-soft">({group.total} {group.total === 1 ? 'idea' : 'ideas'})</span></summary>
            <BacklogGroupTable source={group.source} canEdit={actor.role === 'owner'} pestoOptions={options.pestoStages} hookTemplateOptions={options.hookTemplates} items={group.items.map((item) => ({ libraryId: item.libraryId, revision: item.revision, hook: item.hook, reviewStatus: item.reviewStatus, pesto: item.pesto, platform: item.platform, hookTemplate: item.hookTemplate }))} />
          </details>
        </li>)}</ul>}
    </>
  );
}
