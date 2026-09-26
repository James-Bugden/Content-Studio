import { describe, expect, it } from 'vitest';
import { adjacentPosition } from '@/domain/backlog-navigation';

describe('Backlog editor adjacency', () => {
  const ids = Array.from({ length: 40 }, (_, i) => `SYN-${i + 1}`);

  it('uses the exact current order, including page boundaries in either direction', () => {
    expect(adjacentPosition(ids, 'SYN-1', 1, 1, 3)).toEqual({ id: 'SYN-2', page: 1 });
    expect(adjacentPosition(ids, 'SYN-40', 1, 1, 3)).toEqual({ page: 2, edge: 'first' });
    expect(adjacentPosition(ids, 'SYN-1', -1, 2, 3)).toEqual({ page: 1, edge: 'last' });
    expect(adjacentPosition(ids, 'SYN-40', 1, 3, 3)).toBeNull();
    expect(adjacentPosition(ids, 'SYN-1', -1, 1, 3)).toBeNull();
    expect(adjacentPosition(ids, 'not-in-this-filter', 1, 1, 3)).toBeNull();
  });
});
