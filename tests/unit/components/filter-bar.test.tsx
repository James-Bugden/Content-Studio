// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const nav = vi.hoisted(() => ({ push: vi.fn(), params: new URLSearchParams() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/review',
  useSearchParams: () => nav.params,
}));

import { FilterBar, nextFilterQuery, type FilterDef } from '@/components/filter-bar';
import { resetDirtyStoreForTests, setDirty } from '@/components/dirty-store';

const filters: FilterDef[] = [
  { key: 'platform', label: 'Target platform', options: [{ value: 'X', label: 'X' }, { value: 'Threads', label: 'Threads' }] },
  { key: 'status', label: 'Gate status', options: [{ value: 'ready', label: 'Ready' }, { value: 'blocked', label: 'Blocked' }] },
];

beforeEach(() => {
  nav.push.mockReset();
  nav.params = new URLSearchParams();
  resetDirtyStoreForTests();
});
afterEach(cleanup);

describe('nextFilterQuery (SEC-10)', () => {
  it('never emits a value outside the option list', () => {
    const q = nextFilterQuery(filters, new URLSearchParams(), { key: 'platform', value: 'My whole post text goes here' });
    expect(q).toBe('');
  });

  it('drops invalid values already in the URL on the next write and keeps unrelated IDs', () => {
    const q = nextFilterQuery(filters, new URLSearchParams('platform=secret+draft&item=LIB-0001'), { key: 'status', value: 'blocked' });
    const params = new URLSearchParams(q.slice(1));
    expect(params.get('platform')).toBeNull();
    expect(params.get('status')).toBe('blocked');
    expect(params.get('item')).toBe('LIB-0001');
  });

  it('clear removes every managed filter', () => {
    expect(nextFilterQuery(filters, new URLSearchParams('platform=X&status=ready'), 'clear')).toBe('');
  });
});

describe('FilterBar', () => {
  it('ignores an unknown URL value when reading', () => {
    nav.params = new URLSearchParams('platform=not-a-platform&status=ready');
    render(<FilterBar filters={filters} />);
    expect((screen.getByLabelText('Target platform') as HTMLSelectElement).value).toBe('');
    expect((screen.getByLabelText('Gate status') as HTMLSelectElement).value).toBe('ready');
  });

  it('writes only listed values to the URL', () => {
    nav.params = new URLSearchParams('platform=not-a-platform');
    render(<FilterBar filters={filters} />);
    fireEvent.change(screen.getByLabelText('Gate status'), { target: { value: 'blocked' } });
    expect(nav.push).toHaveBeenCalledTimes(1);
    expect(nav.push.mock.calls[0]?.[0]).toBe('/review?status=blocked');
  });

  it('Clear filters removes them, and is disabled when none are applied', () => {
    nav.params = new URLSearchParams('platform=X');
    const { rerender } = render(<FilterBar filters={filters} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(nav.push.mock.calls[0]?.[0]).toBe('/review');
    nav.params = new URLSearchParams();
    rerender(<FilterBar filters={filters} />);
    expect((screen.getByRole('button', { name: 'Clear filters' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('asks before changing filters while an editor is dirty (UX-04)', () => {
    setDirty('editor', true);
    render(<FilterBar filters={filters} />);
    fireEvent.change(screen.getByLabelText('Target platform'), { target: { value: 'X' } });
    expect(nav.push).not.toHaveBeenCalled();
    expect(screen.getByText('Leave without saving?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Leave and discard changes' }));
    expect(nav.push.mock.calls[0]?.[0]).toBe('/review?platform=X');
  });
});
