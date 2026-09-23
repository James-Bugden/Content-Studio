import type { SlotSummary } from '@/domain/board';
import { CALENDAR_PLATFORMS, formatDayLong, formatDayShort, sortByTime } from '@/domain/calendar';
import { addDays } from '@/domain/schedule';
import { WeekSlotCard } from './slot-card';

/**
 * Week view (UX redesign): one row per platform, one column per day, Monday first.
 * Columns share the width equally (`minmax(0, 1fr)`) and card text is clamped, so
 * the grid never scrolls sideways. Today's column is marked with the focal yellow
 * and the word "Today", never colour alone.
 */
export function WeekGrid({ start, today, slots, className = '' }: { start: string; today: string; slots: SlotSummary[]; className?: string }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  return (
    <div className={`grid-cols-[7rem_repeat(7,minmax(0,1fr))] overflow-hidden rounded-lg border border-line bg-card ${className}`} data-testid="week-grid">
      <div className="border-b border-line bg-paper p-2 text-xs text-ink-soft">Taipei time</div>
      {days.map((d) => {
        const { weekday, date } = formatDayShort(d);
        const isToday = d === today;
        return (
          <div key={d} data-day-header={d} className={`border-b border-l border-line p-2 text-sm ${isToday ? 'bg-focal' : d < today ? 'bg-line/30' : ''}`}>
            <span className="block font-semibold">{weekday}</span>
            <span className="block text-xs">{date}</span>
            {isToday ? <span className="mt-0.5 block text-xs font-bold">Today</span> : null}
          </div>
        );
      })}
      {CALENDAR_PLATFORMS.map((platform, row) => (
        <PlatformRow key={platform} platform={platform} days={days} today={today} slots={slots} last={row === CALENDAR_PLATFORMS.length - 1} />
      ))}
    </div>
  );
}

function PlatformRow({ platform, days, today, slots, last }: { platform: string; days: string[]; today: string; slots: SlotSummary[]; last: boolean }) {
  const border = last ? '' : 'border-b';
  return (
    <>
      <div data-platform-row={platform} className={`${border} border-line bg-paper p-2 text-sm font-semibold`}>
        {platform}
      </div>
      {days.map((d) => {
        const mine = sortByTime(slots.filter((s) => s.platform === platform && s.isoDate === d));
        const past = d < today;
        return (
          <div
            key={d}
            role="group"
            aria-label={`${platform}, ${formatDayLong(d)}`}
            data-date={d}
            className={`${border} flex min-h-24 min-w-0 flex-col gap-1 border-l border-line p-1 ${d === today ? 'bg-focal/20' : past ? 'bg-line/30' : ''}`}
          >
            {mine.map((s) => (
              <WeekSlotCard key={s.contentId} slot={s} past={past} />
            ))}
          </div>
        );
      })}
    </>
  );
}
