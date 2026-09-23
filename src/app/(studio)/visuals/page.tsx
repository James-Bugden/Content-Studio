import type { Metadata } from 'next';
import { getServices } from '@/application/container';
import { loadVisualItems } from '@/application/visuals';
import { ErrorState, GateChip, GuardedLink, PageHeader, StateView } from '@/components';
import { isAppError } from '@/domain/errors';
import type { VisualItemView, VisualList } from '@/domain/visual-studio';
import { requireActor } from '@/lib/auth';

export const metadata: Metadata = { title: 'Visuals | Content Studio' };
export const dynamic = 'force-dynamic';

const APPROVAL_LABEL: Record<VisualItemView['approval'], string> = {
  not_approved: 'Not approved',
  approved: 'Approved (exact revision)',
  approved_legacy: 'Approved outside Content Studio',
  stale: 'Approval is stale',
};

/**
 * Visual Studio list (CS-012). A fresh read of Content Library and Content
 * Schedule: items that still need a visual decision, brief, render or approval
 * come first, each with its blockers in words and any screenshot reuse note.
 */
export default async function VisualsPage() {
  await requireActor('viewer');
  let list: VisualList;
  try {
    list = await loadVisualItems(getServices().repo);
  } catch (error) {
    return (
      <>
        <PageHeader title="Visual studio" description="Decide the visual for each post and approve the exact asset revision." />
        <ErrorState code={isAppError(error) ? error.code : 'UNKNOWN'} />
      </>
    );
  }
  const open = list.items.filter((i) => i.needsAction);
  const done = list.items.filter((i) => !i.needsAction);

  return (
    <>
      <PageHeader
        title="Visual studio"
        description="Choose Text only, an original graphic or an exact screenshot for each post. Original graphics follow SOAR v1.1 C-light and are approved one exact revision at a time."
      />
      <div className="flex flex-col gap-6">
        {list.scheduleUnavailable ? (
          <StateView
            kind="provider_error"
            title="Content Schedule could not be read"
            detail="Screenshot reuse cannot be confirmed, so screenshot decisions stay blocked until it can."
            nextStep="Reload in a moment."
          />
        ) : null}
        {list.items.length === 0 ? (
          <StateView kind="empty" title="The Content Library is empty" detail="There are no rows to decide visuals for." nextStep={null} />
        ) : (
          <>
            <section aria-labelledby="open-h">
              <h2 id="open-h" className="text-lg font-semibold">
                Needs a decision or review <span className="text-ink-soft tabular-nums">({open.length})</span>
              </h2>
              {open.length === 0 ? (
                <p className="mt-2 text-sm text-ink-soft">Every item has a complete, approved visual decision.</p>
              ) : (
                <ul className="mt-3 flex flex-col gap-3">
                  {open.map((item) => (
                    <li key={item.libraryId}>
                      <VisualRow item={item} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section aria-labelledby="done-h">
              <h2 id="done-h" className="text-lg font-semibold">
                Decided and approved <span className="text-ink-soft tabular-nums">({done.length})</span>
              </h2>
              <ul className="mt-3 flex flex-col gap-3">
                {done.map((item) => (
                  <li key={item.libraryId}>
                    <VisualRow item={item} />
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
    </>
  );
}

function VisualRow({ item }: { item: VisualItemView }) {
  const hard = item.gates.filter((g) => g.severity === 'hard');
  return (
    <article aria-labelledby={`v-${item.libraryId}`} className="rounded-lg border border-line bg-card p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={`v-${item.libraryId}`} className="min-w-0 text-base font-semibold">
          <GuardedLink href={`/visuals/${encodeURIComponent(item.libraryId)}`} className="underline decoration-line underline-offset-4 hover:decoration-ink">
            {item.slug || item.libraryId}
          </GuardedLink>
        </h3>
        <p className="text-xs text-ink-soft">
          <span className="font-mono">{item.libraryId}</span> · {item.platformLabel}
          {item.language ? ` · ${item.language}` : ''}
        </p>
      </header>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
        <Fact label="Decision" value={item.decisionLabel} />
        <Fact label="Image status" value={item.imageStatus} />
        <Fact label="Version" value={item.version || 'None yet'} />
        <Fact label="Approval" value={item.decision === 'text_only' ? 'Not needed' : APPROVAL_LABEL[item.approval]} />
      </dl>
      {item.reuse.state !== 'not_applicable' ? <p className="mt-2 text-sm">Screenshot reuse: {item.reuse.message}</p> : null}
      {hard.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-1.5" aria-label="Blockers">
          {hard.map((g, i) => (
            <li key={`${g.code}-${i}`}>
              <GateChip gate={g} />
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-ink-soft">{label}</dt>
      <dd className="truncate font-medium" title={value}>
        {value}
      </dd>
    </div>
  );
}
