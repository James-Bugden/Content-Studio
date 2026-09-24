import type { SlotSummary } from '@/domain/board';
import { dayCounts, formatDayLong, monthOf, urgentCount, type MonthGrid as Grid } from '@/domain/calendar';
import { GuardedLink } from '../guarded-link';

/**
 * Month view (UX redesign): Monday-to-Sunday grid with filled/total slots per
 * platform and a count of urgent steps. Each day opens its week.
 */
const SHORT: Record<string, string> = { X: 'X', Threads: 'TH', LinkedIn: 'LI' };
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function MonthGrid({ grid, today, slots }: { grid: Grid; today: string; slots: SlotSummary[] }) {
  return (
    <div data-testid="month-grid">
      <div aria-hidden="true" className="grid grid-cols-7 gap-1 pb-1 text-center text-xs font-semibold text-ink-soft">
        {WEEKDAYS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <ol className="grid grid-cols-7 gap-1">
        {grid.days.map((d) => {
          const mine = slots.filter((s) => s.isoDate === d);
          const counts = dayCounts(mine);
          const urgent = urgentCount(mine);
          const inMonth = monthOf(d) === grid.month;
          const isToday = d === today;
          const dayNum = Number(d.slice(8, 10));
          const label = [
            formatDayLong(d) + (isToday ? ', today' : ''),
            counts.length ? counts.map((c) => `${c.platform} ${c.filled} of ${c.total} filled`).join(', ') : 'no slots',
            urgent ? `${urgent} urgent` : '',
            'Open week',
          ]
            .filter(Boolean)
            .join('. ');
          return (
            <li key={d} data-date={d} className="min-w-0">
              <GuardedLink
                href={`/schedule?view=week&week=${d}`}
                aria-label={label}
                className={`flex h-full min-h-20 flex-col gap-0.5 rounded-md border p-1 text-left text-[11px] leading-tight hover:border-ink sm:p-2 sm:text-xs ${
                  isToday ? 'border-2 border-primary bg-primary-soft' : urgent ? 'border-2 border-block bg-card' : inMonth ? 'border-line bg-card' : 'border-line bg-paper text-ink-soft'
                }`}
              >
                <span className="flex flex-wrap items-baseline justify-between gap-x-1">
                  <span className="text-sm font-semibold">{dayNum}</span>
                  {isToday ? <span className="text-[10px] font-bold">Today</span> : null}
                </span>
                {urgent ? (
                  <span className="font-bold text-block">
                    {urgent}
                    <span className="hidden sm:inline"> urgent</span>
                  </span>
                ) : null}
                {counts.map((c) => (
                  <span key={c.platform} className="block truncate tabular-nums">
                    {c.platform === 'X' ? (
                      'X'
                    ) : (
                      <>
                        <span className="sm:hidden">{SHORT[c.platform]}</span>
                        <span className="hidden sm:inline">{c.platform}</span>
                      </>
                    )}{' '}
                    {c.filled}/{c.total}
                  </span>
                ))}
              </GuardedLink>
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-xs text-ink-soft">Numbers show filled slots out of all slots for that day. TH is Threads and LI is LinkedIn on small screens.</p>
    </div>
  );
}
