// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startTransition } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

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

  it('toolbar variant (CS-046) keeps real labels and only offers Clear filters when one is applied', () => {
    const { rerender } = render(<FilterBar filters={filters} variant="toolbar" />);
    expect((screen.getByLabelText('Target platform') as HTMLSelectElement).tagName).toBe('SELECT');
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
    nav.params = new URLSearchParams('status=ready');
    rerender(<FilterBar filters={filters} variant="toolbar" />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(nav.push.mock.calls[0]?.[0]).toBe('/review');
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


describe('direct filter chips (CS-059c)', () => {
  it('All on an unselected chip filter preserves pagination without navigating or invoking the dirty guard', () => {
    nav.params = new URLSearchParams('page=3');
    setDirty('editor', true);
    render(<FilterBar filters={[{ ...filters[0]!, control: 'chips' }]} />);
    fireEvent.click(screen.getByRole('button', { name: /^All$/ }));
    expect(nav.push).not.toHaveBeenCalled();
    expect(nav.params.get('page')).toBe('3');
    expect(screen.queryByText('Leave without saving?')).toBeNull();
  });

  it('shares one count, announcement and clear action across chips and disclosed controls', () => {
    nav.params = new URLSearchParams('platform=X&status=ready&page=3&layout=cards');
    render(<FilterBar filters={[{ ...filters[0]!, control: 'chips' }, filters[1]!]} variant="toolbar" disclosureKeys={['status']} />);
    expect(screen.getByText('(2 on)')).toBeTruthy();
    expect(document.querySelectorAll('[aria-live]')).toHaveLength(1);
    expect(screen.getByText('2 filters applied')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Clear filters' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(nav.push.mock.calls[0]?.[0]).toBe('/review?layout=cards');
  });
  it('selects in one click, preserves other filters and removes an active selection', () => {
    nav.params = new URLSearchParams('status=ready&page=3');
    const chips = filters.map((f) => f.key === 'platform' ? { ...f, control: 'chips' as const } : f);
    const { rerender } = render(<FilterBar filters={chips} />);
    fireEvent.click(screen.getByRole('button', { name: /^X$/ }));
    expect(nav.push.mock.calls[0]?.[0]).toBe('/review?platform=X&status=ready');
    nav.params = new URLSearchParams('platform=X&status=ready');
    rerender(<FilterBar filters={chips} />);
    expect(screen.getByRole('button', { name: /^X$/ }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /^X$/ }));
    expect(nav.push.mock.calls[1]?.[0]).toBe('/review?status=ready');
  });

  it('keeps the dirty editor guard for a chip click', () => {
    setDirty('editor', true);
    render(<FilterBar filters={[{ ...filters[0]!, control: 'chips' }]} />);
    fireEvent.click(screen.getByRole('button', { name: /^Threads$/ }));
    expect(nav.push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Leave and discard changes' }));
    expect(nav.push.mock.calls[0]?.[0]).toBe('/review?platform=Threads');
  });
});

it('CS-059g: selected chips use a dark contrasting fill', () => {
  nav.params = new URLSearchParams('platform=X');
  render(<FilterBar filters={[{ ...filters[0]!, control: 'chips' }]} />);
  expect(screen.getByRole('button', { name: /^X$/ }).className).toContain('bg-primary');
  expect(screen.getByRole('button', { name: /^X$/ }).className).toContain('text-white');
});
it('CS-059g: composes rapid chip clicks while navigation is pending', async () => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  nav.push.mockImplementation(() => startTransition(async () => { await pending; }));
  render(<FilterBar filters={filters.map(f => ({ ...f, control: 'chips' }))} />);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /^X$/ }));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Ready' }));
  });
  expect(nav.push.mock.calls[1]?.[0]).toBe('/review?platform=X&status=ready');
  await act(async () => release());
});


it('CS-059j: lane alone offers Clear, ordinary changes retain lane', () => {
  nav.params = new URLSearchParams('lane=review');
  render(<FilterBar filters={filters} variant="toolbar" clearKeys={['lane']} />);
  expect((screen.getByRole('button', { name: 'Clear filters' }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.change(screen.getByLabelText('Target platform'), { target: { value: 'X' } });
  expect(nav.push.mock.calls[0]?.[0]).toBe('/review?lane=review&platform=X');
});
it('CS-059j: equal result text is reinserted on each committed filter change, in one polite region', () => {
  nav.params = new URLSearchParams('platform=X');
  const props = { filters, announcement: 'None match.' };
  const { rerender } = render(<FilterBar {...props} />);
  const region = document.querySelector('[aria-live="polite"]')!;
  const before = region.firstChild;
  nav.params = new URLSearchParams('platform=Threads');
  rerender(<FilterBar {...props} />);
  expect(document.querySelectorAll('[aria-live="polite"]')).toHaveLength(1);
  expect(document.querySelector('[aria-live="polite"]')).toBe(region);
  expect(region.firstChild).not.toBe(before);
  expect(region.textContent).toBe('None match.');
  expect(region.getAttribute('aria-atomic')).toBe('true');
});
it.each(['', 'platform=X&status=ready'])('CS-059j: every chip group has exactly one black selected chip (%s)', query => {
  nav.params = new URLSearchParams(query);
  render(<FilterBar filters={filters.map(f => ({ ...f, control: 'chips' }))} />);
  for (const label of ['Target platform', 'Gate status']) {
    const group = screen.getByRole('group', { name: label });
    expect(group.querySelectorAll('button.bg-primary')).toHaveLength(1);
    expect(group.querySelector('button.bg-primary')?.getAttribute('aria-pressed')).toBe('true');
  }
});

it('CS-059j: pending navigation inserts nothing, then commits exactly one new result announcement', async () => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  nav.push.mockImplementation(() => startTransition(async () => { await pending; }));
  const chips = filters.map(f => ({ ...f, control: 'chips' as const }));
  const { rerender } = render(<FilterBar filters={chips} announcement="Showing 1 to 25 of 40" />);
  const region = document.querySelector('[aria-live="polite"]')!;
  const events: string[] = [];
  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'childList') for (const node of record.addedNodes) events.push(`insert: ${node.textContent}`);
      if (record.type === 'characterData') events.push(`text: ${record.target.textContent}`);
    }
  });
  observer.observe(region, { childList: true, subtree: true, characterData: true });
  try {
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^X$/ })); });
    expect(nav.push).toHaveBeenCalledWith('/review?platform=X', { scroll: false });
    expect(screen.getByRole('button', { name: /^X$/ }).getAttribute('aria-pressed')).toBe('true');
    expect(events).toEqual([]);
    await act(async () => {
      nav.params = new URLSearchParams('platform=X');
      rerender(<FilterBar filters={chips} announcement="Showing 1 to 3 of 3" />);
      release();
    });
    expect(document.querySelector('[aria-live="polite"]')).toBe(region);
    expect(events).toEqual(['insert: Showing 1 to 3 of 3']);
  } finally {
    observer.disconnect();
    await act(async () => release());
  }
});

it('CS-059j: the default filter-count text is announced exactly once across pending and commit', async () => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  nav.push.mockImplementation(() => startTransition(async () => { await pending; }));
  nav.params = new URLSearchParams('');
  const chips = filters.map(f => ({ ...f, control: 'chips' as const }));
  const { rerender } = render(<FilterBar filters={chips} />);
  const region = document.querySelector('[aria-live="polite"]')!;
  const events: string[] = [];
  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'childList') for (const node of record.addedNodes) events.push(`insert: ${node.textContent}`);
      if (record.type === 'characterData') events.push(`text: ${record.target.textContent}`);
    }
  });
  observer.observe(region, { childList: true, subtree: true, characterData: true });
  try {
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^X$/ })); });
    await act(async () => {
      nav.params = new URLSearchParams('platform=X');
      rerender(<FilterBar filters={chips} />);
      release();
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatch(/1 filter applied/);
  } finally {
    observer.disconnect();
    await act(async () => release());
  }
});
