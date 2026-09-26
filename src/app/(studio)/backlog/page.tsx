import type { Metadata } from 'next';
import { getServices } from '@/application/container';
import { loadBacklogOptions, loadBacklogGroups, type BacklogFilters } from '@/application/backlog';
import { PageHeader, StateView } from '@/components';
import { BacklogGroupTable } from '@/components/backlog/backlog-group-table';
import { LibraryBacklogTable } from '@/components/backlog/library-backlog-table';
import { FilterBar } from '@/components/filter-bar';
import { PLATFORMS, type Platform } from '@/domain/enums';
import { libraryBacklogView } from '@/domain/library-backlog';
import { requireActor } from '@/lib/auth';

export const metadata: Metadata = { title: 'Backlog | Content Studio' };
export const dynamic = 'force-dynamic';

type Params = Record<string, string | string[] | undefined>;
function one(params: Params, key: string): string | undefined { return typeof params[key] === 'string' ? params[key] : undefined; }
function platform(params: Params): Platform | undefined {
  const raw = one(params, 'platform');
  return raw && (PLATFORMS as readonly string[]).includes(raw) ? raw as Platform : undefined;
}
function pageHref(params: Params, page: number): string {
  const query = new URLSearchParams();
  if (one(params, 'source')) query.set('source', one(params, 'source')!);
  if (platform(params)) query.set('platform', platform(params)!);
  query.set('page', String(page));
  return `/backlog?${query}`;
}

export default async function BacklogPage({ searchParams }: { searchParams: Promise<Params> }) {
  const actor = await requireActor('viewer');
  const { repo } = getServices();
  const params = await searchParams;
  const ideas = one(params, 'view') === 'ideas';
  if (!ideas) {
    const library = await repo.listLibrary();
    const requestedPage = Number(one(params, 'page'));
    const view = libraryBacklogView(library, {
      source: one(params, 'source'), platform: platform(params),
      page: Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1,
    });
    return (
      <>
        <PageHeader title="Backlog" description="Unedited posts from the Content Library Sheet. Filter by source, open a post and work through the list." />
        <nav aria-label="Backlog views" className="mb-4 flex gap-3 text-sm"><span aria-current="page" className="font-semibold">Posts ({library.length})</span><a className="text-primary underline" href="/backlog?view=ideas">Ideas in Content Queue</a></nav>
        <FilterBar filters={[
          { key: 'source', label: 'Content Source', options: view.sources.map((s) => ({ value: s, label: s })) },
          { key: 'platform', label: 'Platform', options: view.platforms.map((p) => ({ value: p, label: p })) },
        ]} />
        <p className="mb-3 text-sm text-ink-soft">{view.total} {view.total === 1 ? 'post' : 'posts'} · page {view.page} of {view.totalPages}. Typefully readiness is confirmed after the existing schedule checks.</p>
        {view.total === 0 ? <StateView kind="no_match" detail={library.length ? 'No posts match these filters.' : 'The Content Library is empty.'} action={null} /> : <LibraryBacklogTable rows={view.rows} />}
        {view.totalPages > 1 ? <nav aria-label="Backlog pages" className="mt-4 flex items-center justify-between text-sm">
          {view.page > 1 ? <a className="min-h-11 py-3 text-primary underline" href={pageHref(params, view.page - 1)}>Previous page</a> : <span />}
          <span>Page {view.page} / {view.totalPages}</span>
          {view.page < view.totalPages ? <a className="min-h-11 py-3 text-primary underline" href={pageHref(params, view.page + 1)}>Next page</a> : <span />}
        </nav> : null}
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
