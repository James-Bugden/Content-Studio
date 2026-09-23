import { describe, expect, it } from 'vitest';
import type { SlotSummary } from '@/domain/board';
import type { NextStep } from '@/domain/next-steps';
import {
  addMonths,
  collapseEmptyRuns,
  dayCounts,
  dayWorthListing,
  formatDayLong,
  formatWeekRange,
  monthGrid,
  needsYou,
  parseIsoDate,
  parseMonth,
  parseView,
  runSummary,
  slotStatus,
  sortByTime,
  urgentCount,
} from '@/domain/calendar';

const step = (kind: NextStep['kind'], urgency: NextStep['urgency'], action: string = kind): NextStep => ({ kind, action, why: '', urgency });

function slot(over: Partial<SlotSummary> & Pick<SlotSummary, 'contentId'>): SlotSummary {
  return {
    isoDate: over.contentId.slice(0, 10),
    slot: 'Main',
    platform: 'X',
    time: '08:00',
    expectedPillar: 'Trending',
    hook: '',
    statusLabel: 'Open',
    thumb: null,
    libraryId: null,
    parentContentId: '',
    step: step('fill_slot', 'soon', 'Fill slot'),
    empty: true,
    ...over,
  };
}

const filled = (id: string, time: string, extra: Partial<SlotSummary> = {}) =>
  slot({ contentId: id, time, hook: 'A hook', empty: false, statusLabel: 'Scheduled', step: step('wait', 'none', 'Scheduled'), ...extra });

describe('URL parsing', () => {
  it('falls back to the week view for anything unknown', () => {
    expect(parseView('month')).toBe('month');
    expect(parseView('list')).toBe('list');
    expect(parseView('agenda')).toBe('week');
    expect(parseView(['month'])).toBe('week');
    expect(parseView(undefined)).toBe('week');
  });
  it('accepts only real dates and months', () => {
    expect(parseIsoDate('2026-10-01')).toBe('2026-10-01');
    expect(parseIsoDate('2026-02-30')).toBeNull();
    expect(parseIsoDate('2026-10-1')).toBeNull();
    expect(parseMonth('2026-10')).toBe('2026-10');
    expect(parseMonth('2026-13')).toBeNull();
    expect(parseMonth('2026-10-01')).toBeNull();
  });
  it('adds months across a year end', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
  });
});

describe('monthGrid', () => {
  it('covers October 2026 in whole Monday-to-Sunday weeks', () => {
    const g = monthGrid('2026-10');
    expect(g.first).toBe('2026-09-28');
    expect(g.days[0]).toBe('2026-09-28');
    expect(g.days.at(-1)).toBe('2026-11-01');
    expect(g.days).toHaveLength(35);
  });
  it('never exceeds 42 days and always has whole weeks', () => {
    for (let m = 0; m < 36; m++) {
      const g = monthGrid(addMonths('2026-01', m));
      expect(g.days.length % 7).toBe(0);
      expect(g.days.length).toBeGreaterThanOrEqual(28);
      expect(g.days.length).toBeLessThanOrEqual(42);
      expect(g.days).toContain(`${g.month}-01`);
    }
  });
  it('handles a month that starts on a Monday (February 2027 is four weeks)', () => {
    const g = monthGrid('2027-02');
    expect(g.first).toBe('2027-02-01');
    expect(g.days).toHaveLength(28);
  });
});

describe('formatting is Taipei-date based, not browser-timezone based', () => {
  it('names days and weeks from the ISO date alone', () => {
    expect(formatDayLong('2026-10-01')).toBe('Thursday 1 October');
    expect(formatWeekRange('2026-09-28')).toMatch(/^28 Sept? to 4 Oct 2026$/);
  });
});

describe('collapseEmptyRuns', () => {
  const a = filled('2026-10-01-MAIN-X', '08:00');
  const e1 = slot({ contentId: '2026-10-01-2ND-X', time: '20:00' });
  const e2 = slot({ contentId: '2026-10-01-2ND-TH', platform: 'Threads', time: '20:15', step: step('wait', 'later', 'Waiting for X') });
  const e3 = slot({ contentId: '2026-10-01-MAIN-LI', platform: 'LinkedIn', time: '21:00' });
  const b = filled('2026-10-01-3RD-X', '23:00');

  it('folds consecutive empty slots into one run and keeps filled ones', () => {
    const items = collapseEmptyRuns([a, e1, e2, e3, b]);
    expect(items.map((i) => i.kind)).toEqual(['slot', 'run', 'slot']);
    expect(items[1]).toEqual({ kind: 'run', slots: [e1, e2, e3] });
  });
  it('leaves a single empty slot as a slot', () => {
    expect(collapseEmptyRuns([a, e1, b]).map((i) => i.kind)).toEqual(['slot', 'slot', 'slot']);
  });
  it('handles a trailing run and an all-empty day', () => {
    expect(collapseEmptyRuns([a, e1, e3]).map((i) => i.kind)).toEqual(['slot', 'run']);
    expect(collapseEmptyRuns([e1, e3])).toEqual([{ kind: 'run', slots: [e1, e3] }]);
    expect(collapseEmptyRuns([])).toEqual([]);
  });
  it('summarises a run in words', () => {
    expect(runSummary([e1, e2, e3])).toBe('2 open slots, 1 waiting for X');
    expect(runSummary([e1])).toBe('1 open slot');
    const missed = slot({ contentId: '2026-09-29-MAIN-X', step: step('done', 'none', 'Missed') });
    expect(runSummary([missed, e2])).toBe('1 waiting for X, 1 missed');
  });
});

describe('day helpers', () => {
  const day = [
    filled('2026-10-01-MAIN-X', '08:00'),
    slot({ contentId: '2026-10-01-2ND-X', time: '20:00' }),
    slot({ contentId: '2026-10-01-3RD-TH', platform: 'Threads', time: 'No time', step: step('wait', 'later', 'Waiting for X') }),
    filled('2026-10-01-MAIN-TH', '08:15', { platform: 'Threads', step: step('update_chinese', 'now', 'Update Chinese') }),
  ];
  it('orders slots by time, then platform, with no time last', () => {
    expect(sortByTime(day).map((s) => s.contentId)).toEqual(['2026-10-01-MAIN-X', '2026-10-01-MAIN-TH', '2026-10-01-2ND-X', '2026-10-01-3RD-TH']);
  });
  it('counts filled and total per platform', () => {
    expect(dayCounts(day)).toEqual([
      { platform: 'X', filled: 1, total: 2 },
      { platform: 'Threads', filled: 1, total: 2 },
    ]);
    expect(urgentCount(day)).toBe(1);
  });
  it('lists a day with content or an open slot, not one that only waits', () => {
    expect(dayWorthListing(day)).toBe(true);
    expect(dayWorthListing([day[2]!])).toBe(false);
  });
  it('needsYou: urgent first, then soon in time order; skips waits and other weeks', () => {
    const later = slot({ contentId: '2026-10-09-MAIN-X', isoDate: '2026-10-09' });
    const ids = needsYou([...day, later], '2026-09-28', '2026-10-04').map((s) => s.contentId);
    expect(ids).toEqual(['2026-10-01-MAIN-TH', '2026-10-01-2ND-X']);
  });
});

describe('slotStatus never relies on colour', () => {
  it.each([
    [filled('2026-10-01-MAIN-X', '08:00', { statusLabel: 'Published' }), '✓', 'Published'],
    [filled('2026-10-01-MAIN-X', '08:00', { statusLabel: 'Scheduled' }), '◐', 'Scheduled'],
    [filled('2026-10-01-MAIN-X', '08:00', { statusLabel: 'Typefully Draft' }), '◐', 'Planned'],
    [filled('2026-10-01-MAIN-X', '08:00', { statusLabel: 'ZH Review' }), '◑', 'In review'],
    [slot({ contentId: '2026-10-01-2ND-X' }), '○', 'Open'],
    [slot({ contentId: '2026-10-01-2ND-TH', step: step('wait', 'later', 'Waiting for X') }), '·', 'Waiting for X'],
    [slot({ contentId: '2026-09-29-2ND-X', step: step('done', 'none', 'Missed') }), '×', 'Missed'],
  ])('%#: glyph %s and word %s', (s, glyph, label) => {
    expect(slotStatus(s)).toMatchObject({ glyph, label });
  });
});
