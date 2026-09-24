import type { Metadata } from 'next';
import { getServices } from '@/application/container';
import { loadBacklogGroups } from '@/application/backlog';
import { PageHeader, StateView } from '@/components';
import { BacklogGroupTable } from '@/components/backlog/backlog-group-table';
import { requireActor } from '@/lib/auth';

export const metadata: Metadata = { title: 'Backlog | Content Studio' };
export const dynamic = 'force-dynamic';

/**
 * Backlog (Content Queue idea-stage rows), spreadsheet-style. One collapsible
 * group per source (same accordion pattern as Posts' Sources block), all closed
 * by default so the page opens short. Inside each group a dense table, close to
 * the Content Queue tab itself: row number, Library ID, the hook edited in
 * place, and the next action done in place. The row itself still opens the
 * full side panel for draft-content editing.
 *
 * `canEdit` comes from the same actor resolution `/api/me` reports to the queue
 * panel: only the owner may write.
 */
export default async function BacklogPage() {
  const actor = await requireActor('viewer');
  const canEdit = actor.role === 'owner';
  const { repo } = getServices();
  const groups = await loadBacklogGroups(repo);
  const total = groups.reduce((sum, g) => sum + g.total, 0);

  return (
    <>
      <PageHeader title="Backlog" description="Ideas waiting to become posts. Edit a hook in place, approve or skip it, or open a row to draft." />
      {total === 0 ? (
        <StateView kind="empty" title="The backlog is empty" detail="There are no ideas waiting. New ideas appear here once they are added to the Content Queue." nextStep={null} />
      ) : (
        <ul className="flex flex-col gap-3">
          {groups.map((group) => (
            <li key={group.source}>
              <details className="group rounded-lg border border-line bg-card">
                <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-2 px-4 py-2 text-sm marker:hidden [&::-webkit-details-marker]:hidden">
                  <span aria-hidden="true" className="inline-block text-ink-soft transition-transform duration-150 group-open:rotate-90">
                    ▸
                  </span>
                  <span className="font-semibold">{group.source}</span>
                  <span className="text-ink-soft">
                    ({group.total} {group.total === 1 ? 'idea' : 'ideas'})
                  </span>
                </summary>
                <BacklogGroupTable
                  source={group.source}
                  canEdit={canEdit}
                  items={group.items.map((item) => ({ libraryId: item.libraryId, revision: item.revision, hook: item.hook, reviewStatus: item.reviewStatus }))}
                />
              </details>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
