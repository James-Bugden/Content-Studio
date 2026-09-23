import type { Metadata } from 'next';
import { getServices } from '@/application/container';
import { loadTypefullyDetail } from '@/application/typefully-view';
import { ErrorState, GuardedLink, PageHeader } from '@/components';
import { TypefullyPanel } from '@/components/typefully/typefully-panel';
import { isAppError } from '@/domain/errors';
import { contentIdSchema } from '@/domain/mutation';
import { formatTaipei, type TypefullyDetailView } from '@/domain/typefully-view';
import { requireActor } from '@/lib/auth';

export const metadata: Metadata = { title: 'Schedule row | Content Studio' };
export const dynamic = 'force-dynamic';

/**
 * One Schedule row with its Typefully reconciliation (CS-015). Row facts come
 * from the Sheet; the panel shows which of the five Typefully states applies and
 * offers only explicit, owner-only actions. Review and scheduling do not depend
 * on Typefully being reachable.
 */
export default async function ScheduleRowPage({ params }: { params: Promise<{ contentId: string }> }) {
  const actor = await requireActor('viewer');
  const { contentId } = await params;
  const back = (
    <GuardedLink href="/schedule" className="text-sm underline">
      Back to the schedule
    </GuardedLink>
  );
  if (!contentIdSchema.safeParse(contentId).success) {
    return (
      <>
        <PageHeader title="Schedule row" actions={back} />
        <ErrorState code="NOT_FOUND" action={back} />
      </>
    );
  }
  let view: TypefullyDetailView;
  try {
    const { repo, typefully } = getServices();
    view = await loadTypefullyDetail(repo, typefully, contentId);
  } catch (error) {
    return (
      <>
        <PageHeader title="Schedule row" actions={back} />
        <ErrorState code={isAppError(error) ? error.code : 'UNKNOWN'} action={back} />
      </>
    );
  }
  const r = view.row;
  const facts: [string, React.ReactNode][] = [
    ['Content ID', <span key="id" className="font-mono">{r.contentId}</span>],
    ['Parent', r.parentContentId ? <span key="p" className="font-mono">{r.parentContentId}</span> : 'None'],
    ['Date', r.isoDate ? `${r.displayDate || r.isoDate} (${r.isoDate})` : r.displayDate || 'Not set'],
    ['Platform', r.platformRaw || 'Blank'],
    ['Slot', r.slot || 'Blank'],
    ['Taipei time', r.plannedAt ? (formatTaipei(r.plannedAt) ?? r.publishTime) : r.publishTime || 'Not set'],
    ['Stage', r.stage],
    ['Typefully status', r.typefullyStatus],
    ['Typefully Draft ID', r.draftId ? <span key="d" className="font-mono">{r.draftId}</span> : 'Not linked'],
    [
      'Source',
      r.libraryId ? (
        <span key="s">
          <span className="font-mono">#lib={r.libraryId}</span> ·{' '}
          <GuardedLink href={`/review/${encodeURIComponent(r.libraryId)}`} className="underline">
            Open in the editor
          </GuardedLink>
        </span>
      ) : (
        'No Library lineage recorded'
      ),
    ],
    ['Visual', `${r.visual.source}${r.visual.version ? ` · version ${r.visual.version}` : ''}${r.visual.imageStatus ? ` · ${r.visual.imageStatus}` : ''}`],
  ];
  if (r.zh) {
    facts.push([
      'Chinese adaptation',
      <GuardedLink key="zh" href={`/schedule/${encodeURIComponent(r.zh.xContentId)}/adapt`} className="underline">
        {r.zh.state === 'approved' ? 'Approved and current' : r.zh.state === 'stale' ? 'Out of date' : r.zh.state.replace(/_/g, ' ')} · open the Threads adaptation
      </GuardedLink>,
    ]);
  }

  return (
    <>
      <PageHeader title={r.contentId} description={`${r.platformRaw || 'Unknown platform'} ${r.slot} · all times are Taipei`} actions={back} />
      <div className="mt-4 flex flex-col gap-6">
        <section aria-labelledby="facts-h" className="rounded-lg border border-line bg-card p-4">
          <h2 id="facts-h" className="text-lg font-semibold">
            Row facts
          </h2>
          <dl className="mt-2 grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
            {facts.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="font-medium text-ink-soft">{k}</dt>
                <dd className="min-w-0 break-words">{v}</dd>
              </div>
            ))}
          </dl>
        </section>
        <TypefullyPanel initial={view} canEdit={actor.role === 'owner'} />
      </div>
    </>
  );
}
