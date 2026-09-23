import type { Metadata } from 'next';
import { getServices } from '@/application/container';
import { loadBoard } from '@/application/board';
import { today as taipeiTodayForServer } from '@/application/schedule';
import { ErrorState, PageHeader } from '@/components';
import { CalendarNav } from '@/components/calendar/calendar-nav';
import { DayList } from '@/components/calendar/day-list';
import { MonthGrid } from '@/components/calendar/month-grid';
import { NeedsStrip } from '@/components/calendar/needs-strip';
import { WeekGrid } from '@/components/calendar/week-grid';
import type { Board } from '@/domain/board';
import {
  addMonths,
  formatDayLong,
  formatMonth,
  formatWeekRange,
  monthGrid,
  monthOf,
  needsYou,
  parseIsoDate,
  parseMonth,
  parseView,
} from '@/domain/calendar';
import { isAppError } from '@/domain/errors';
import { addDays, weekStart } from '@/domain/schedule';
import { requireActor } from '@/lib/auth';

export const metadata: Metadata = { title: 'Calendar | Content Studio' };
export const dynamic = 'force-dynamic';

/**
 * Calendar (UX redesign). Week, month and list views over the board read model,
 * with "Needs you this week" on top so the next thing to do is obvious. Every date
 * is Taipei and comes from Content IDs, never from the browser's timezone (UX-07).
 * Cards open the slot panel (`?slot=<Content ID>`).
 */
export default async function SchedulePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireActor('viewer');
  const sp = await searchParams;
  const view = parseView(sp.view);
  const day = taipeiTodayForServer();
  const thisWeek = weekStart(day);
  const week = weekStart(parseIsoDate(sp.week) ?? day);
  const month = parseMonth(sp.month) ?? monthOf(parseIsoDate(sp.week) ?? day);
  const grid = monthGrid(month);
  const repo = getServices().repo;

  let board: Board;
  let stripBoard: Board;
  try {
    if (view === 'month') {
      const covers = thisWeek >= grid.first && addDays(thisWeek, 6) <= grid.days[grid.days.length - 1]!;
      board = await loadBoard(repo, { from: grid.first, days: grid.days.length });
      stripBoard = covers ? board : await loadBoard(repo, { from: thisWeek, days: 7 });
    } else {
      board = await loadBoard(repo, { from: week, days: 7 });
      stripBoard = board;
    }
  } catch (error) {
    return (
      <>
        <PageHeader title="Calendar" description="Your posts by day and platform, in Taipei time." />
        <ErrorState code={isAppError(error) ? error.code : 'UNKNOWN'} />
      </>
    );
  }

  const stripWeek = view === 'month' ? thisWeek : week;
  const isThisWeek = stripWeek === thisWeek;
  const needs = needsYou(stripBoard.slots, stripWeek, addDays(stripWeek, 6));
  const period =
    view === 'month'
      ? { label: formatMonth(month), unit: 'month' as const, prev: addMonths(month, -1), next: addMonths(month, 1) }
      : { label: formatWeekRange(week), unit: 'week' as const, prev: addDays(week, -7), next: addDays(week, 7) };

  return (
    <>
      <PageHeader title="Calendar" description="Your posts by day and platform. All times are Taipei." />
      <NeedsStrip
        heading={isThisWeek ? 'Needs you this week' : `Needs you in the week of ${formatDayLong(stripWeek)}`}
        emptyText={isThisWeek ? 'Nothing needs you this week.' : 'Nothing needs you that week.'}
        items={needs}
      />
      <CalendarNav view={view} period={period} week={week} month={month} />
      <div className="mt-4">
        {view === 'month' ? (
          <MonthGrid grid={grid} today={board.today} slots={board.slots} />
        ) : (
          <>
            {view === 'week' ? <WeekGrid className="hidden md:grid" start={week} today={board.today} slots={board.slots} /> : null}
            <DayList className={view === 'week' ? 'flex md:hidden' : 'flex'} start={week} today={board.today} slots={board.slots} />
          </>
        )}
      </div>
    </>
  );
}
