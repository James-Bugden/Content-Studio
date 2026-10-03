import { describe, expect, it } from 'vitest';
import {
  BACKLOG_SORTS, backlogGroupKey, compareBacklog, groupBacklogRows, libraryBacklogView, nextHeaderSort,
  type BacklogSort,
} from '@/domain/library-backlog';
import type { LibraryRecord } from '@/domain/records';
import { FakeSheetTransport } from '@/integrations/google/fake-sheet';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';

type Overrides = Partial<{
  source: string; platform: 'LinkedIn' | 'X' | 'Threads' | null; pesto: string; hook: string; hookTemplate: string;
  review: 'Pending' | 'Approved' | 'Changes Requested' | 'Skipped' | null; state: string;
}>;

async function template(): Promise<LibraryRecord> {
  return (await new SheetsContentRepository(new FakeSheetTransport()).listLibrary())[0]!;
}

function make(base: LibraryRecord, row: number, o: Overrides): LibraryRecord {
  return { ...base, row, value: {
    ...base.value,
    libraryId: `SYNTH-SORT-${row}`,
    contentSource: o.source ?? '',
    targetPlatform: o.platform === null || o.platform === undefined ? { ok: false, raw: '', reason: 'unrecognised' } : { ok: true, value: o.platform },
    pesto: o.pesto ?? '',
    currentHook: o.hook ?? '',
    hookTemplate: o.hookTemplate ?? '',
    reviewStatus: o.review === null || o.review === undefined ? { ok: false, raw: '', reason: 'unrecognised' } : { ok: true, value: o.review },
    state: o.state ?? 'Editing',
    draftContent: 'Synthetic draft',
    queueForSchedule: false,
  } };
}

const ids = (rows: LibraryRecord[]) => rows.map((r) => r.row);

describe('Backlog sort comparator', () => {
  it('offers every column the issue names', () => {
    for (const key of ['sheet', 'source', 'platform', 'pesto', 'hookTemplate', 'status', 'approved', 'hook']) {
      expect(BACKLOG_SORTS).toContain(key);
    }
  });

  const cases: Array<{ key: BacklogSort; rows: Overrides[]; asc: number[]; desc?: number[] }> = [
    // rows are created at sheet rows 2, 3, 4, 5 (blank value at row 3 in every case)
    { key: 'source', rows: [{ source: 'Beta' }, { source: '' }, { source: 'alpha' }, { source: 'Gamma' }], asc: [4, 2, 5, 3] },
    { key: 'platform', rows: [{ platform: 'X' }, { platform: null }, { platform: 'LinkedIn' }, { platform: 'Threads' }], asc: [4, 5, 2, 3] },
    { key: 'pesto', rows: [{ pesto: 'Story' }, { pesto: '  ' }, { pesto: 'Expertise' }, { pesto: 'Opinion' }], asc: [4, 5, 2, 3] },
    { key: 'hookTemplate', rows: [{ hookTemplate: 'List #2' }, { hookTemplate: '' }, { hookTemplate: 'Contrarian #12' }, { hookTemplate: 'Question #3' }], asc: [4, 2, 5, 3] },
    { key: 'hook', rows: [{ hook: 'Zebra' }, { hook: '' }, { hook: 'Apple' }, { hook: 'Mango' }], asc: [4, 5, 2, 3] },
    { key: 'approved', rows: [{ review: 'Pending' }, { review: null }, { review: 'Approved' }, { review: 'Skipped' }], asc: [4, 2, 5, 3], desc: [2, 5, 4, 3] },
  ];

  for (const c of cases) {
    it(`sorts by ${c.key} in both directions with blanks last`, async () => {
      const base = await template();
      const rows = c.rows.map((o, i) => make(base, i + 2, o));
      const asc = [...rows].sort((a, b) => compareBacklog(a, b, c.key, 'asc'));
      expect(ids(asc)).toEqual(c.asc);
      const desc = [...rows].sort((a, b) => compareBacklog(a, b, c.key, 'desc'));
      const nonBlank = c.asc.filter((r) => r !== 3);
      expect(ids(desc)).toEqual(c.desc ?? [...nonBlank].reverse().concat(3));
    });
  }

  it('sorts by computed status using the readiness label when one exists', async () => {
    const base = await template();
    const rows = [make(base, 2, { review: 'Approved' }), make(base, 3, { review: 'Skipped' }), make(base, 4, { review: 'Pending' })];
    const statusOf = (r: LibraryRecord) => r.row === 4 ? 'Ready to schedule' : undefined;
    expect(ids([...rows].sort((a, b) => compareBacklog(a, b, 'status', 'asc', statusOf)))).toEqual([2, 4, 3]);
    expect(ids([...rows].sort((a, b) => compareBacklog(a, b, 'status', 'desc', statusOf)))).toEqual([3, 4, 2]);
  });

  it('sorts by sheet row in both directions', async () => {
    const base = await template();
    const rows = [make(base, 9, {}), make(base, 2, {}), make(base, 5, {})];
    expect(ids([...rows].sort((a, b) => compareBacklog(a, b, 'sheet', 'asc')))).toEqual([2, 5, 9]);
    expect(ids([...rows].sort((a, b) => compareBacklog(a, b, 'sheet', 'desc')))).toEqual([9, 5, 2]);
  });

  it('breaks ties by sheet row ascending in either direction (stable across pages)', async () => {
    const base = await template();
    const rows = [make(base, 7, { source: 'Same' }), make(base, 3, { source: 'Same' }), make(base, 5, { source: 'Same' })];
    expect(ids([...rows].sort((a, b) => compareBacklog(a, b, 'source', 'asc')))).toEqual([3, 5, 7]);
    expect(ids([...rows].sort((a, b) => compareBacklog(a, b, 'source', 'desc')))).toEqual([3, 5, 7]);
  });

  it('sorts the whole inventory before pagination, in either direction', async () => {
    const base = await template();
    const rows = Array.from({ length: 85 }, (_, i) => make(base, i + 2, { source: `Source ${String(i).padStart(3, '0')}` }));
    const first = libraryBacklogView(rows, { sort: 'source', dir: 'desc', page: 1 });
    expect(first.rows[0]?.value.contentSource).toBe('Source 084');
    const last = libraryBacklogView(rows, { sort: 'source', dir: 'desc', page: 3 });
    expect(last.rows.at(-1)?.value.contentSource).toBe('Source 000');
    expect(libraryBacklogView(rows, { sort: 'sheet', dir: 'desc' }).rows[0]?.row).toBe(86);
  });
});

describe('Backlog header click', () => {
  it('starts a new column ascending and reverses the same column', () => {
    expect(nextHeaderSort({}, 'sheet')).toEqual({ sort: 'sheet', dir: 'desc' });
    expect(nextHeaderSort({ sort: 'sheet', dir: 'desc' }, 'sheet')).toEqual({ sort: 'sheet', dir: 'asc' });
    expect(nextHeaderSort({}, 'source')).toEqual({ sort: 'source', dir: 'asc' });
    expect(nextHeaderSort({ sort: 'source' }, 'source')).toEqual({ sort: 'source', dir: 'desc' });
    expect(nextHeaderSort({ sort: 'source', dir: 'desc' }, 'pesto')).toEqual({ sort: 'pesto', dir: 'asc' });
  });
});

describe('Backlog grouping and PESTO filter', () => {
  it('filters by PESTO and lists PESTO options', async () => {
    const base = await template();
    const rows = [make(base, 2, { pesto: 'Story' }), make(base, 3, { pesto: 'Expertise' }), make(base, 4, { pesto: '' })];
    const view = libraryBacklogView(rows, { pesto: 'Story' });
    expect(ids(view.rows)).toEqual([2]);
    expect(view.pestoOptions).toEqual(['Expertise', 'Story']);
  });

  it('keeps groups contiguous across pages by sorting on the group key first, then the chosen column', async () => {
    const base = await template();
    const rows = Array.from({ length: 90 }, (_, i) => make(base, i + 2, {
      platform: i % 3 === 0 ? 'X' : i % 3 === 1 ? 'LinkedIn' : null,
      hook: `Hook ${String(i).padStart(3, '0')}`,
    }));
    const pages = [1, 2, 3].flatMap((page) => libraryBacklogView(rows, { group: 'platform', sort: 'hook', dir: 'desc', page }).rows);
    const keys = pages.map((r) => backlogGroupKey(r, 'platform'));
    // LinkedIn, X, then blank platform last, each run contiguous.
    expect(keys.slice(0, 30).every((k) => k === 'LinkedIn')).toBe(true);
    expect(keys.slice(30, 60).every((k) => k === 'X')).toBe(true);
    expect(keys.slice(60).every((k) => k === '')).toBe(true);
    // Within a group, the chosen column and direction still apply.
    expect(pages[0]?.value.currentHook).toBe('Hook 088');
    const view = libraryBacklogView(rows, { group: 'platform', page: 1 });
    expect(view.groupTotals).toEqual({ LinkedIn: 30, X: 30, '': 30 });
  });

  it('groups a page into labelled runs in order', async () => {
    const base = await template();
    const rows = [make(base, 2, { source: 'A' }), make(base, 3, { source: 'A' }), make(base, 4, { source: '' }), make(base, 5, { source: 'B' })];
    const groups = groupBacklogRows(rows, 'source');
    expect(groups.map((g) => [g.key, g.label, ids(g.rows)])).toEqual([
      ['A', 'A', [2, 3]], ['', 'No source', [4]], ['B', 'B', [5]],
    ]);
    expect(groupBacklogRows(rows, undefined)).toEqual([{ key: '', label: '', rows }]);
    const statusGroups = groupBacklogRows([make(base, 2, { review: 'Approved' })], 'status', () => 'Ready to schedule');
    expect(statusGroups[0]?.label).toBe('Ready to schedule');
  });
});
