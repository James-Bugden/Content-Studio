// @vitest-environment jsdom
import { act, fireEvent } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { BacklogNavigationProvider } from '@/components/backlog/backlog-navigation';
import { LibraryBacklogExplorer } from '@/components/backlog/library-backlog-explorer';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/backlog',
  useSearchParams: () => new URLSearchParams('page=2'),
}));
vi.mock('@/components/leave-confirm', () => ({ useLeaveConfirmation: () => ({ guard: vi.fn(), dialog: null }) }));
vi.mock('@/components/backlog/library-backlog-table', () => ({ LibraryBacklogTable: () => null }));

it('keeps server-rendered search read-only until hydration can retain the typed query', async () => {
  const tree = <BacklogNavigationProvider><LibraryBacklogExplorer
    initial={{ ok: true, rows: [], statuses: {}, total: 0, page: 2, totalPages: 2 }} filters={{}}
  /></BacklogNavigationProvider>;
  const container = document.createElement('div');
  container.innerHTML = renderToString(tree);
  document.body.append(container);
  let root: ReturnType<typeof hydrateRoot> | undefined;
  try {
    const input = container.querySelector('input[type="search"]') as HTMLInputElement;
    expect(input.readOnly).toBe(true);
    await act(async () => { root = hydrateRoot(container, tree); });
    expect(input.readOnly).toBe(false);
    fireEvent.change(input, { target: { value: 'Synthetic body 1988.' } });
    expect(input.value).toBe('Synthetic body 1988.');
  } finally {
    await act(async () => root?.unmount());
    container.remove();
  }
});
