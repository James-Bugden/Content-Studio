import { describe, expect, it } from 'vitest';
import { historyMode, RAPID_CHANGE_MS } from '@/lib/client/url-state';
import { listMemoryKey, readListMemory, writeListMemory } from '@/lib/client/list-memory';

describe('history mode (#247)', () => {
  it('pushes the first change and replaces rapid ones', () => {
    expect(historyMode(0, 10_000)).toBe('push');
    expect(historyMode(10_000, 10_000 + RAPID_CHANGE_MS - 1)).toBe('replace');
    expect(historyMode(10_000, 10_000 + RAPID_CHANGE_MS)).toBe('push');
  });
});

describe('list memory (#247)', () => {
  const store = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };

  it('keys by page and view params, ignoring the open panel and param order', () => {
    const a = listMemoryKey('/backlog', new URLSearchParams('sort=hook&status=Ready&post=SYN-L001'));
    const b = listMemoryKey('/backlog', new URLSearchParams('status=Ready&sort=hook'));
    expect(a).toBe(b);
    expect(a).not.toBe(listMemoryKey('/backlog', new URLSearchParams('status=Ready')));
  });

  it('round-trips scroll and last row and rejects junk', () => {
    const s = store();
    writeListMemory(s, 'k', { scrollY: 420, lastId: 'SYN-L007' });
    expect(readListMemory(s, 'k')).toEqual({ scrollY: 420, lastId: 'SYN-L007' });
    s.setItem('bad', JSON.stringify({ scrollY: -5, lastId: '<script>' }));
    expect(readListMemory(s, 'bad')).toEqual({ scrollY: 0, lastId: null });
    s.setItem('worse', '{nope');
    expect(readListMemory(s, 'worse')).toBeNull();
    expect(readListMemory(null, 'k')).toBeNull();
  });
});
