import { describe, expect, it } from 'vitest';
import { parseBacklogUrl, serializeBacklogUrl } from '@/domain/backlog-url';

describe('Backlog URL state (#247)', () => {
  it('round-trips every view param and drops defaults', () => {
    const input = new URLSearchParams('view=ideas&source=Synthetic%20Source&platform=X&pesto=Problem&status=Ready&sort=hook&dir=desc&group=platform&page=3&post=SYN-L001');
    const state = parseBacklogUrl(input);
    expect(state).toEqual({ view: 'ideas', source: 'Synthetic Source', platform: 'X', pesto: 'Problem', status: 'Ready', sort: 'hook', dir: 'desc', group: 'platform', page: 3 });
    const out = serializeBacklogUrl(state, new URLSearchParams('post=SYN-L001'));
    expect(parseBacklogUrl(out)).toEqual(state);
    expect(out.get('post')).toBe('SYN-L001');
    expect(serializeBacklogUrl({ view: 'posts', page: 1, dir: 'asc' }).toString()).toBe('');
  });

  it('ignores values that are not allowed and unreadable pages', () => {
    const state = parseBacklogUrl({ platform: 'Myspace', sort: 'nonsense', dir: 'up', group: 'x', page: '-4', view: 'other', source: 'a'.repeat(500) });
    expect(state).toEqual({ view: 'posts', page: 1 });
    expect(parseBacklogUrl({ page: 'abc' }).page).toBe(1);
    expect(parseBacklogUrl({ source: ['first', 'second'] }).source).toBe('first');
  });

  it('does not read or invent search text', () => {
    const out = serializeBacklogUrl({ ...parseBacklogUrl(new URLSearchParams('q=secret&search=secret')), page: 2 });
    expect(out.toString()).toBe('page=2');
    expect(parseBacklogUrl(out)).not.toHaveProperty('q');
  });
});
