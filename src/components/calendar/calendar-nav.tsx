import type { CalendarView } from '@/domain/calendar';
import { GuardedLink } from '../guarded-link';

/**
 * View switch (week, month, list) and Previous / Today / Next for the calendar.
 * State lives in the URL (`?view=`, `?week=`, `?month=`) so every view can be
 * linked and reloaded.
 */
type Period = { label: string; unit: 'week' | 'month'; prev: string; next: string };

const VIEWS: { view: CalendarView; label: string }[] = [
  { view: 'week', label: 'Week' },
  { view: 'month', label: 'Month' },
  { view: 'list', label: 'List' },
];

function href(view: CalendarView, key: 'week' | 'month', value?: string): string {
  const p = new URLSearchParams({ view });
  if (value) p.set(key, value);
  return `/schedule?${p.toString()}`;
}

const pill = 'inline-flex min-h-11 items-center justify-center px-4 text-sm font-medium';

export function CalendarNav({ view, period, week, month }: { view: CalendarView; period: Period; week: string; month: string }) {
  const key = period.unit;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <nav aria-label="Calendar view">
        <ul className="inline-flex overflow-hidden rounded-md border border-line bg-card">
          {VIEWS.map((v, i) => {
            const active = v.view === view;
            return (
              <li key={v.view} className={i > 0 ? 'border-l border-line' : ''}>
                <GuardedLink
                  href={v.view === 'month' ? href('month', 'month', month) : href(v.view, 'week', week)}
                  aria-current={active ? 'page' : undefined}
                  className={`${pill} ${active ? 'bg-ink text-white' : 'text-ink hover:bg-paper'}`}
                >
                  {v.label}
                </GuardedLink>
              </li>
            );
          })}
        </ul>
      </nav>
      <nav aria-label={period.unit === 'week' ? 'Weeks' : 'Months'} className="flex flex-wrap items-center gap-2">
        <GuardedLink href={href(view, key, period.prev)} aria-label={`Previous ${period.unit}`} className={`${pill} rounded-md border border-line bg-card hover:bg-paper`}>
          <span aria-hidden="true">‹</span>&nbsp;Previous
        </GuardedLink>
        <GuardedLink href={href(view, key)} className={`${pill} rounded-md border border-line bg-card hover:bg-paper`}>
          Today
        </GuardedLink>
        <GuardedLink href={href(view, key, period.next)} aria-label={`Next ${period.unit}`} className={`${pill} rounded-md border border-line bg-card hover:bg-paper`}>
          Next&nbsp;<span aria-hidden="true">›</span>
        </GuardedLink>
        <p className="w-full text-sm font-semibold sm:w-auto sm:pl-2" aria-live="polite">
          {period.label}
        </p>
      </nav>
    </div>
  );
}
