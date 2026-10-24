// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { NavigationBadge, NavigationCountsProvider } from '@/components/navigation-counts';

const navigation = vi.hoisted(() => ({ pathname: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => navigation.pathname }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); navigation.pathname = '/'; });
const tree = () => <NavigationCountsProvider><NavigationBadge href="/" /><NavigationBadge href="/reconcile" /></NavigationCountsProvider>;

it('shows a known zero while hiding an unknown count', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ nextUp: 0, fixIssues: null, expiresAt: Date.now() + 15_000 }) }));
  const { container } = render(tree());
  await screen.findByText('0');
  expect(container.querySelector('[data-nav-count="/reconcile"]')).toBeNull();
});

it('hides both numbers on a failed request', async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ nextUp: 3, fixIssues: 2, expiresAt: Date.now() + 15_000 }) });
  vi.stubGlobal('fetch', fetcher);
  const { rerender, container } = render(tree());
  await screen.findByText('3');
  fetcher.mockRejectedValueOnce(new Error('synthetic unavailable cache'));
  navigation.pathname = '/reconcile';
  rerender(tree());
  await waitFor(() => expect(container.querySelectorAll('[data-nav-count]').length).toBe(0));
});

it('removes expired numbers without requiring another navigation', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ nextUp: 3, fixIssues: 2, expiresAt: Date.now() + 1000 }) }));
  const { container } = render(tree());
  await act(async () => { await Promise.resolve(); });
  expect(container.querySelector('[data-nav-count="/"]')?.textContent).toBe('3');
  await act(async () => { vi.advanceTimersByTime(1000); });
  expect(container.querySelectorAll('[data-nav-count]').length).toBe(0);
});

it('retries only the cache when a streamed action page has not finished its existing read', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ nextUp: null, fixIssues: null, expiresAt: Date.now() }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ nextUp: 4, fixIssues: null, expiresAt: Date.now() + 1000 }) });
  vi.stubGlobal('fetch', fetcher);
  const { container } = render(tree());
  await act(async () => { await Promise.resolve(); });
  expect(container.querySelectorAll('[data-nav-count]').length).toBe(0);
  await act(async () => { vi.advanceTimersByTime(500); });
  expect(container.querySelector('[data-nav-count="/"]')?.textContent).toBe('4');
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls.every(([url]) => url === '/api/navigation-counts')).toBe(true);
});

it('hides previous-page counts while the new cache request remains pending', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ nextUp: 3, fixIssues: 2, expiresAt: Date.now() + 15_000 }) })
    .mockImplementationOnce(() => new Promise(() => {}));
  vi.stubGlobal('fetch', fetcher);
  const { container, rerender } = render(tree());
  await screen.findByText('3');
  navigation.pathname = '/review';
  rerender(tree());
  expect(container.querySelectorAll('[data-nav-count]').length).toBe(0);
});

it('caps very large counts so the phone tab bar cannot overflow', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ nextUp: 1100, fixIssues: 999, expiresAt: Date.now() + 15_000 }) }));
  const { container } = render(tree());
  await screen.findByText('999+');
  expect(container.querySelector('[data-nav-count="/"]')?.textContent).toBe('999+');
  expect(container.querySelector('[data-nav-count="/reconcile"]')?.textContent).toBe('999');
});
