import type { SlotSummary } from '@/domain/board';
import { collapseEmptyRuns, dayWorthListing, formatDayLong, runSummary, slotStatus, sortByTime } from '@/domain/calendar';
import { addDays } from '@/domain/schedule';
import { OpenPanelLink } from '../panel/open-panel-link';
import { ListSlotCard } from './slot-card';

/**
 * List view (UX redesign), and the phone layout of the week view. Only days with
 * content or an open slot are shown; runs of empty slots fold into one line such
 * as "3 open slots" with a Fill link per slot inside.
 */
export function DayList({ start, today, slots, className = '' }: { start: string; today: string; slots: SlotSummary[]; className?: string }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))
    .map((d) => ({ date: d, slots: sortByTime(slots.filter((s) => s.isoDate === d)) }))
    .filter((d) => dayWorthListing(d.slots));
  return (
    <div className={`flex-col gap-5 ${className}`} data-testid="day-list">
      {days.length === 0 ? (
        <p className="rounded-md border border-dashed border-line bg-card p-4 text-sm text-ink-soft">Nothing is planned this week, and there are no open slots.</p>
      ) : (
        days.map((d) => {
          const past = d.date < today;
          const id = `list-${d.date}`;
          return (
            <section key={d.date} aria-labelledby={id} data-date={d.date}>
              <div className="flex flex-wrap items-baseline gap-2">
                <h2 id={id} className="text-base font-semibold">
                  {formatDayLong(d.date)}
                </h2>
                {d.date === today ? <span className="rounded bg-primary-soft px-1.5 text-xs font-bold text-primary">Today</span> : null}
                {past ? <span className="text-xs text-ink-soft">Past</span> : null}
              </div>
              <ul className="mt-2 flex flex-col gap-2">
                {collapseEmptyRuns(d.slots).map((item) =>
                  item.kind === 'slot' ? (
                    <li key={item.slot.contentId}>
                      <ListSlotCard slot={item.slot} past={past} />
                    </li>
                  ) : (
                    <li key={item.slots[0]!.contentId}>
                      <EmptyRun slots={item.slots} />
                    </li>
                  ),
                )}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}

function EmptyRun({ slots }: { slots: SlotSummary[] }) {
  return (
    <details className="rounded-md border border-dashed border-line bg-card text-sm" data-empty-run={slots.length}>
      <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-3 text-ink-soft">
        <span aria-hidden="true">○</span>
        {runSummary(slots)}
      </summary>
      <ul className="flex flex-col border-t border-line">
        {slots.map((s) => {
          const st = slotStatus(s);
          return (
            <li key={s.contentId} data-content-id={s.contentId} className="flex min-h-11 items-center justify-between gap-2 border-b border-line px-3 last:border-b-0">
              <span>
                <span className="font-semibold">{s.platform}</span> · <span className="tabular-nums">{s.time}</span>
                {st.look !== 'open' ? (
                  <span className="text-ink-soft">
                    {' '}
                    · {st.look === 'waiting' ? null : <span aria-hidden="true">{st.glyph} </span>}
                    {st.label}
                  </span>
                ) : null}
              </span>
              {s.step.kind === 'fill_slot' ? (
                <OpenPanelLink target={{ slot: s.contentId }} label={`Fill ${s.platform} ${s.time}`} className="inline-flex min-h-11 items-center px-3 font-semibold text-primary underline">
                  Fill
                </OpenPanelLink>
              ) : null}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
