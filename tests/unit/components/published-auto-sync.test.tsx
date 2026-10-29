// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { PublishedAutoSync } from '@/components/published/published-auto-sync';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
beforeEach(() => { window.localStorage.clear(); refresh.mockReset(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const old = new Date(Date.now() - 100 * 3_600_000).toISOString();
const rows = ['SYN-1', 'SYN-2'].map((id) => ({ contentId: id, revision: 'r1', draftId: `d-${id}`, status: 'Published', finalSyncAt: old, analyticsSyncAt: old }));

it('syncs stale rows in the background, then refreshes once', async () => {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push(url);
    const body = JSON.parse(String(init.body)) as { operationId: string; expectedRevision: string };
    expect(body.operationId).toMatch(/^tf[sa]_/);
    return Response.json({ ok: true, replayed: false, revision: `${body.expectedRevision}+` });
  }));
  const { container } = render(<PublishedAutoSync rows={rows} />);
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  expect(calls.sort()).toEqual([
    '/api/schedule/SYN-1/typefully/analytics', '/api/schedule/SYN-1/typefully/sync-final',
    '/api/schedule/SYN-2/typefully/analytics', '/api/schedule/SYN-2/typefully/sync-final',
  ]);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(container.textContent).toBe('');
});

it('shows one quiet message when a row fails and does nothing when nothing is stale', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: false, code: 'PROVIDER_UNAVAILABLE' })));
  const { container, unmount } = render(<PublishedAutoSync rows={rows} />);
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  expect(container.textContent).toBe('Some rows could not sync. Use Sync on the card.');
  unmount();
  window.localStorage.clear();
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  const fresh = new Date().toISOString();
  render(<PublishedAutoSync rows={rows.map((r) => ({ ...r, finalSyncAt: fresh, analyticsSyncAt: fresh }))} />);
  await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  expect(fetcher).not.toHaveBeenCalled();
});
