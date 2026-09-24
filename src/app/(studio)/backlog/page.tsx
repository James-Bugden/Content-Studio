import type { Metadata } from 'next';
import { getServices } from '@/application/container';
import { loadBacklogGroups } from '@/application/backlog';
import { PageHeader, StateView } from '@/components';
import { OpenPanelLink } from '@/components/panel/open-panel-link';
import { PostThumb } from '@/components/panel/post-thumb';
import { buttonClass } from '@/components/button-styles';
import { readableTitle } from '@/domain/display';
import { requireActor } from '@/lib/auth';

export const metadata: Metadata = { title: 'Backlog | Content Studio' };
export const dynamic = 'force-dynamic';

/**
 * Backlog (Content Queue idea-stage rows). Deliberately lighter than Posts:
 * nothing here has QA, review or image status yet, so a row is only a
 * thumbnail, a hook and one action. Grouped by source, one details/summary
 * block per group (same accordion pattern as Posts' Sources block), all
 * closed by default so the page opens short.
 */
export default async function BacklogPage() {
  await requireActor('viewer');
  const { repo } = getServices();
  const groups = await loadBacklogGroups(repo);
  const total = groups.reduce((sum, g) => sum + g.total, 0);

  return (
    <>
      <PageHeader title="Backlog" description="Ideas waiting to become posts. Open one to start drafting." />
      {total === 0 ? (
        <StateView kind="empty" title="The backlog is empty" detail="There are no ideas waiting. New ideas appear here once they are added to the Content Queue." nextStep={null} />
      ) : (
        <ul className="flex flex-col gap-3">
          {groups.map((group) => (
            <li key={group.source}>
              <details className="rounded-lg border border-line bg-card px-4">
                <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-x-2 py-2 text-sm">
                  <span className="font-semibold">{group.source}</span>
                  <span className="text-ink-soft">
                    ({group.total} {group.total === 1 ? 'idea' : 'ideas'})
                  </span>
                </summary>
                <ul className="flex flex-col divide-y divide-line pb-2">
                  {group.items.map((item) => (
                    <li key={item.libraryId} className="flex items-start gap-3 py-3">
                      <PostThumb thumb={item.thumb} size="sm" showLabel={false} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium first-letter:uppercase">{readableTitle(item.slug) || item.libraryId}</p>
                        {item.hook ? <p className="copy line-clamp-2 text-sm text-ink-soft">{item.hook}</p> : null}
                      </div>
                      <OpenPanelLink target={{ queue: item.libraryId }} className={`${buttonClass()} shrink-0`}>
                        Start drafting
                      </OpenPanelLink>
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
