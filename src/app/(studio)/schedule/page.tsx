import type { Metadata } from 'next';
import { getServices } from '@/application/container';
import { loadCalendar, type CalendarCell, type CalendarWeek } from '@/application/schedule';
import { ErrorState, GuardedLink, PageHeader, StateView } from '@/components';
import { isAppError } from '@/domain/errors';
import { addDays } from '@/domain/schedule';
import { requireActor } from '@/lib/auth';

export const metadata: Metadata = { title: 'Schedule | Content Studio' };
export const dynamic = 'force-dynamic';

const ZH_LABEL: Record<string, string> = {
  missing: 'Threads: not adapted yet',
  draft: 'Threads: draft',
  awaiting_review: 'Threads: awaiting Chinese review',
  approved: 'Threads: approved',
  stale: 'Threads: out of date',
  ambiguous: 'Threads: several rows claim this post',
  not_required: '',
};

function formatDay(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
}

/**
 * Schedule week view (CS-014). A list per day in Taipei time, built from Content
 * IDs so a browser in another timezone sees the same days. Status is words and
 * shapes, never colour alone (UX-07). Drag and drop is out of MVP.
 */
export default async function SchedulePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireActor('viewer');
  const sp = await searchParams;
  const week = typeof sp.week === 'string' ? sp.week : undefined;
  let cal: CalendarWeek;
  try {
    cal = await loadCalendar(getServices().repo, week);
  } catch (error) {
    return (
      <>
        <PageHeader title="Schedule" description="Planned slots by platform, in Taipei time." />
        <ErrorState code={isAppError(error) ? error.code : 'UNKNOWN'} />
      </>
    );
  }
  const total = cal.days.reduce((n, d) => n + d.cells.length, 0);

  return (
    <>
      <PageHeader title="Schedule" description={`Week of ${formatDay(cal.start)}. All times are Taipei.`} />
      <nav aria-label="Weeks" className="mt-4 flex flex-wrap items-center gap-3 text-sm">
        <GuardedLink href={`/schedule?week=${addDays(cal.start, -7)}`} className="underline">
          Previous week
        </GuardedLink>
        <GuardedLink href="/schedule" className="underline">
          This week
        </GuardedLink>
        <GuardedLink href={`/schedule?week=${addDays(cal.start, 7)}`} className="underline">
          Next week
        </GuardedLink>
      </nav>
      <div className="mt-4 flex flex-col gap-5">
        {cal.unparsed > 0 ? (
          <StateView kind="blocked" title="Some rows have non-standard Content IDs" detail={`${cal.unparsed} rows are not shown because their Content ID does not follow YYYY-MM-DD-SLOT-PLATFORM.`} nextStep="Fix the Content IDs in the Sheet." />
        ) : null}
        {total === 0 ? (
          <StateView kind="empty" title="No slot rows this week" detail="The Sheet has no Content Schedule rows for these dates." nextStep={null} />
        ) : (
          cal.days.map((d) => (
            <section key={d.isoDate} aria-labelledby={`d-${d.isoDate}`}>
              <h2 id={`d-${d.isoDate}`} className="text-base font-semibold">
                {formatDay(d.isoDate)}
              </h2>
              {d.cells.length === 0 ? (
                <p className="text-sm text-ink-soft">No slots.</p>
              ) : (
                <ul className="mt-2 flex flex-col gap-2">
                  {d.cells.map((c) => (
                    <li key={c.contentId}>
                      <SlotRow cell={c} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))
        )}
      </div>
    </>
  );
}

function SlotRow({ cell }: { cell: CalendarCell }) {
  const state = cell.typefullyStatus === 'Published' ? '● Published' : cell.available ? '○ Open slot' : cell.typefullyStatus !== 'Not Sent' ? `◐ ${cell.typefullyStatus}` : `◑ ${cell.stage}`;
  return (
    <div className={`grid gap-2 rounded-md border p-3 text-sm sm:grid-cols-[5rem_7rem_minmax(0,1fr)_auto] ${cell.available ? 'border-dashed border-line bg-paper' : 'border-line bg-card'}`}>
      <span className="font-semibold tabular-nums">{cell.time}</span>
      <span>
        {cell.platform} {cell.slot}
      </span>
      <div className="min-w-0">
        {cell.hook ? <p className="copy truncate font-medium">{cell.hook}</p> : <p className="text-ink-soft">Empty</p>}
        <p className="text-xs text-ink-soft">
          <span className="font-mono">{cell.contentId}</span>
          {cell.parentContentId ? ` · from ${cell.parentContentId}` : ''}
          {cell.libraryId ? ` · Library ${cell.libraryId}` : ''}
        </p>
        {cell.zh && ZH_LABEL[cell.zh] ? (
          <p className="text-xs">
            {ZH_LABEL[cell.zh]} ·{' '}
            <GuardedLink href={`/schedule/${encodeURIComponent(cell.contentId)}/adapt`} className="underline">
              Threads adaptation
            </GuardedLink>
          </p>
        ) : null}
      </div>
      <span className="flex flex-wrap items-baseline gap-x-3 text-sm">
        <span>{state}</span>
        {!cell.available ? (
          <GuardedLink href={`/schedule/${encodeURIComponent(cell.contentId)}`} className="underline" aria-label={`Details for ${cell.contentId}`}>
            Details
          </GuardedLink>
        ) : null}
      </span>
    </div>
  );
}
