/** The adjacent position is either on the current bounded page or its immediate neighbour. */
export function adjacentPosition(ids: readonly string[], current: string, direction: -1 | 1, page: number, totalPages: number): { id?: string; page: number; edge?: 'first' | 'last' } | null {
  const index = ids.indexOf(current);
  if (index < 0) return null;
  const next = index + direction;
  if (next >= 0 && next < ids.length) return { id: ids[next], page };
  if (direction < 0 && page > 1) return { page: page - 1, edge: 'last' };
  if (direction > 0 && page < totalPages) return { page: page + 1, edge: 'first' };
  return null;
}
