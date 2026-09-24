import type { Metadata } from 'next';
import { getServices } from '@/application/container';
import { loadReadyQueue } from '@/application/ready';
import { ErrorState, GateChip, GuardedLink, NextAction, PageHeader, StateView, StatusBadge, buttonClass } from '@/components';
import { isAppError } from '@/domain/errors';
import type { ReadyItem, ReadyQueue } from '@/domain/views';
import { requireActor } from '@/lib/auth';

export const metadata: Metadata = { title: 'Ready | Content Studio' };
export const dynamic = 'force-dynamic';

const GROUPS: { key: ReadyItem['group']; title: string; description: string }[] = [
  { key: 'ready', title: 'Ready to schedule', description: 'Every hard gate passes. Preview the promotion to pick a slot.' },
  { key: 'needs_action', title: 'Needs action', description: 'An ordinary next step is still open.' },
  { key: 'blocked', title: 'Blocked', description: 'A problem must be fixed before this can move.' },
  { key: 'scheduled', title: 'Already scheduled', description: 'Promoted into Content Schedule.' },
];

/**
 * Ready Queue (CS-013). Reads the Sheet's own Ready Queue view, then re-reads
 * every item from Content Library and re-runs the gates, so a stale formula view
 * can never show something as Ready (READY-03, READY-06).
 */
export default async function ReadyPage() {
  const actor = await requireActor('viewer');
  let queue: ReadyQueue;
  try {
    queue = await loadReadyQueue(getServices().repo);
  } catch (error) {
    return (
      <>
        <PageHeader title="Ready queue" description="Approved and queued items, rechecked against every release gate." />
        <ErrorState code={isAppError(error) ? error.code : 'UNKNOWN'} />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Ready queue" description="Approved and queued items, rechecked against every release gate before anything moves to the schedule." />
      <div className="mt-4 flex flex-col gap-6">
        {queue.scheduleUnavailable ? (
          <StateView kind="provider_error" title="Content Schedule could not be read" detail="Screenshot reuse and existing slots cannot be confirmed, so nothing can be promoted right now." nextStep="Reload in a moment." />
        ) : null}
        {queue.orphans.length > 0 ? (
          <StateView
            kind="conflict"
            title="The Ready Queue view lists rows missing from Content Library"
            detail={`Ignored until they match a Library row: ${queue.orphans.join(', ')}.`}
            nextStep="Check the Ready Queue formula in the Sheet."
          />
        ) : null}
        {queue.items.length === 0 ? (
          <StateView kind="empty" title="Nothing is approved and queued yet" detail="Approve an item and tick Queue for Schedule in the review queue to see it here." nextStep={null} />
        ) : (
          GROUPS.map((g) => {
            const items = queue.items.filter((i) => i.group === g.key);
            return (
              <section key={g.key} aria-labelledby={`g-${g.key}`}>
                <h2 id={`g-${g.key}`} className="text-lg font-semibold">
                  {g.title} <span className="text-sm font-normal text-ink-soft">({items.length})</span>
                </h2>
                <p className="text-sm text-ink-soft">{g.description}</p>
                {items.length === 0 ? (
                  <p className="mt-2 text-sm text-ink-soft">None.</p>
                ) : (
                  <ul className="mt-3 flex flex-col gap-3">
                    {items.map((item) => (
                      <li key={item.libraryId}>
                        <ReadyCard item={item} canEdit={actor.role === 'owner'} />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })
        )}
      </div>
    </>
  );
}

function ReadyCard({ item, canEdit }: { item: ReadyItem; canEdit: boolean }) {
  return (
    <article aria-labelledby={`r-${item.libraryId}`} className="rounded-lg border border-line bg-card p-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id={`r-${item.libraryId}`} className="font-semibold">
            {item.slug || item.libraryId}
          </h3>
          <p className="text-xs text-ink-soft">
            <span className="font-mono">{item.libraryId}</span> · {item.targetPlatform} · {item.source} · Visual: {item.visual}
          </p>
        </div>
        {item.group === 'scheduled' ? (
          <span className="rounded-full border border-line px-3 py-1 text-sm">▣ Scheduled</span>
        ) : (
          <StatusBadge status={item.group} />
        )}
      </header>
      <p className="copy mt-2 font-semibold">{item.hook}</p>
      <p className="copy mt-1 line-clamp-3 text-sm text-ink-soft">{item.preview}</p>
      {item.viewDrift ? (
        <p className="mt-2 text-sm text-ink-soft">The Ready Queue tab shows different values from Content Library; the Library row is used.</p>
      ) : null}
      {item.group === 'scheduled' ? (
        <p className="mt-2 text-sm">
          Scheduled as{' '}
          {item.scheduledAs.map((s, i) => (
            <span key={s.contentId}>
              {i > 0 ? ', ' : ''}
              <span className="font-mono">{s.contentId}</span>
            </span>
          ))}
          .
        </p>
      ) : (
        <>
          <div className="mt-3">
            <NextAction gate={item.gates.next} />
          </div>
          {item.gates.blockers.length > 1 ? (
            <ul className="mt-2 flex flex-col gap-1.5">
              {item.gates.blockers.slice(1).map((g, i) => (
                <li key={`${g.code}-${i}`}>
                  <GateChip gate={g} />
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
      {item.notes.map((n) => (
        <p key={n} className="mt-2 text-sm text-ink-soft">
          Note: {n}
        </p>
      ))}
      <div className="mt-3 flex flex-wrap gap-2">
        {item.group === 'ready' && canEdit ? (
          <GuardedLink href={`/ready/${encodeURIComponent(item.libraryId)}/promote`} className={buttonClass('primary')}>
            Preview promotion
          </GuardedLink>
        ) : null}
        <GuardedLink href={`/review/${encodeURIComponent(item.libraryId)}`} className={buttonClass()}>
          Open editor
        </GuardedLink>
      </div>
    </article>
  );
}
