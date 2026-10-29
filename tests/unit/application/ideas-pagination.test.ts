import { describe, expect, it } from 'vitest';
import { IDEAS_PAGE_SIZE, paginateBacklogGroups, type BacklogGroup } from '@/application/backlog';

const group = (source: string, count: number): BacklogGroup => ({
  source, total: count,
  items: Array.from({ length: count }, (_, i) => ({ libraryId: `${source}-${i + 1}` }) as BacklogGroup['items'][number]),
});

describe('paginateBacklogGroups (#251)', () => {
  const groups = [group('A', 150), group('B', 130)];

  it('shows 40 ideas per page and counts pages from the filtered total', () => {
    expect(IDEAS_PAGE_SIZE).toBe(40);
    const first = paginateBacklogGroups(groups, 1);
    expect(first).toMatchObject({ page: 1, totalPages: 7, total: 280 });
    expect(first.groups.map(g => g.items.length)).toEqual([40]);
  });

  it('cuts across a group edge in order and keeps the group total', () => {
    const page = paginateBacklogGroups(groups, 4);
    expect(page.groups.map(g => [g.source, g.items.length, g.total])).toEqual([['A', 30, 150], ['B', 10, 130]]);
    expect(page.groups[1]!.items[0]!.libraryId).toBe('B-1');
  });

  it('every idea appears exactly once across the pages', () => {
    const seen = Array.from({ length: 7 }, (_, i) => paginateBacklogGroups(groups, i + 1).groups.flatMap(g => g.items.map(x => x.libraryId))).flat();
    expect(seen).toHaveLength(280);
    expect(new Set(seen).size).toBe(280);
  });

  it('clamps a page past the end or below one, and handles no ideas', () => {
    expect(paginateBacklogGroups(groups, 99).page).toBe(7);
    expect(paginateBacklogGroups(groups, 0).page).toBe(1);
    expect(paginateBacklogGroups(groups, Number.NaN).page).toBe(1);
    expect(paginateBacklogGroups([], 3)).toEqual({ groups: [], page: 1, totalPages: 1, total: 0 });
  });
});
