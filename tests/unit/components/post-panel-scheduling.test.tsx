// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
import { PostPanel } from '@/components/panel/post-panel';

const slots = [
  { contentId: '2026-10-01-MAIN-LI', isoDate: '2026-10-01', time: '21:00', slot: 'Main' },
  { contentId: '2026-10-02-MAIN-LI', isoDate: '2026-10-02', time: '21:00', slot: 'Main' },
];
const data = {
  summary: { title: 'Synthetic approved post', platform: 'LinkedIn', reviewStatus: 'Approved', thumb: null, scheduledAs: [], step: { kind: 'schedule', action: 'Schedule', why: 'Ready', urgency: 'next' } },
  card: { reviewStatus: 'Approved', gates: { blockers: [], warnings: [] } },
  model: { markdown: { state: 'unavailable' }, sheet: { draft: 'Synthetic draft.' } },
  ns: 'synthetic', canEdit: true, slotOptions: slots,
};
const response = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
const preview = (contentId: string) => ({ ok: true, contentId, libraryRevision: 'library-rev', scheduleRevision: 'slot-rev', preview: [{ field: 'hook', header: 'Hook', after: 'Synthetic hook.' }] });

beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('previews the first open slot automatically and only writes after explicit confirm', async () => {
  const fetcher = vi.mocked(fetch).mockImplementation(async (url, init) => {
    if (String(url).includes('/api/panel/')) return response({ ok: true, data });
    if (init?.method === 'POST') return response({ ok: true, replayed: false, contentId: slots[0]!.contentId });
    return response(preview(slots[0]!.contentId));
  });
  render(<PostPanel libraryId="SYN-L005" />);
  const confirm = await screen.findByRole('button', { name: 'Confirm and write to Thu 1 Oct \u00b7 21:00' });
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
  expect(screen.getByText('These cells will be written to the Schedule. Nothing else changes.')).toBeTruthy();
  fireEvent.click(confirm);
  await screen.findByText(/Scheduled into 2026-10-01-MAIN-LI/);
  const writes = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(writes).toHaveLength(1);
  expect(JSON.parse(String(writes[0]?.[1]?.body))).toMatchObject({ contentId: slots[0]!.contentId, expectedLibraryRevision: 'library-rev', expectedScheduleRevision: 'slot-rev' });
});

it('a slow default preview cannot replace a later explicit slot choice', async () => {
  let release!: (value: Response) => void;
  let firstStarted = false;
  vi.mocked(fetch).mockImplementation(async (url) => {
    if (String(url).includes('/api/panel/')) return response({ ok: true, data });
    if (String(url).includes('2026-10-01-MAIN-LI')) {
      firstStarted = true;
      return new Promise<Response>((resolve) => { release = resolve; });
    }
    return response(preview(slots[1]!.contentId));
  });
  render(<PostPanel libraryId="SYN-L005" />);
  await waitFor(() => expect(firstStarted).toBe(true));
  fireEvent.click(screen.getByRole('button', { name: 'Fri 2 Oct \u00b7 21:00' }));
  await screen.findByRole('button', { name: 'Confirm and write to Fri 2 Oct \u00b7 21:00' });
  await act(async () => { release(response(preview(slots[0]!.contentId))); });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Fri 2 Oct \u00b7 21:00' }).getAttribute('aria-pressed')).toBe('true'));
  expect(screen.queryByRole('button', { name: 'Confirm and write to Thu 1 Oct \u00b7 21:00' })).toBeNull();
});

it('does not offer confirm when no usable slot exists', async () => {
  const fetcher = vi.mocked(fetch).mockResolvedValue(response({ ok: true, data: { ...data, slotOptions: [] } }));
  render(<PostPanel libraryId="SYN-L005" />);
  await screen.findByText('No open LinkedIn slots in the next three weeks.');
  expect(screen.queryByRole('button', { name: /Confirm and write/ })).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('uses the snapshot preview without another GET and retains an operation only for the same revisions', async () => {
  let revision = 'slot-rev';
  const fetcher = vi.mocked(fetch).mockImplementation(async (_url, init) => {
    if (init?.method === 'POST') return response({ ok: false, code: 'STALE_READ' });
    return response({ ok: true, data: { ...data, initialPreview: { ...preview(slots[0]!.contentId), scheduleRevision: revision } } });
  });
  const { rerender } = render(<PostPanel libraryId="SYN-L005" />);
  const label = 'Confirm and write to Thu 1 Oct \u00b7 21:00';
  fireEvent.click(await screen.findByRole('button', { name: label }));
  await screen.findByText(/Reload this page to see the new preview/);
  fireEvent.click(screen.getByRole('button', { name: label }));
  await waitFor(() => expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2));
  const writes = () => fetcher.mock.calls.filter(([, init]) => init?.method === 'POST').map(([, init]) => JSON.parse(String(init?.body)));
  expect(writes()[1].operationId).toBe(writes()[0].operationId);
  expect(fetcher.mock.calls.filter(([, init]) => !init?.method)).toHaveLength(1);
  // Reload the same slot from the panel read with a newer Schedule revision.
  revision = 'slot-rev-new';
  rerender(<PostPanel libraryId="SYN-L005-refreshed" />);
  await waitFor(() => expect(screen.queryByText(/Reload this page to see the new preview/)).toBeNull());
  fireEvent.click(await screen.findByRole('button', { name: label }));
  await waitFor(() => expect(writes()).toHaveLength(3));
  expect(writes()[2].operationId).not.toBe(writes()[0].operationId);
  expect(writes()[2].expectedScheduleRevision).toBe('slot-rev-new');
});

it('tries the next default after a failed preview and keeps every selector available after all fail', async () => {
  vi.mocked(fetch).mockImplementation(async (url) => {
    if (String(url).includes('/api/panel/')) return response({ ok: true, data });
    if (String(url).includes(slots[0]!.contentId)) throw new Error('Synthetic read failure');
    return response(preview(slots[1]!.contentId));
  });
  render(<PostPanel libraryId="SYN-L005" />);
  await screen.findByRole('button', { name: 'Confirm and write to Fri 2 Oct \u00b7 21:00' });
  vi.mocked(fetch).mockResolvedValue(response({ ok: false }));
  fireEvent.click(screen.getByRole('button', { name: 'Thu 1 Oct \u00b7 21:00' }));
  await screen.findByText('This slot cannot be used.');
  expect(screen.queryByRole('button', { name: /Confirm and write/ })).toBeNull();
  expect((screen.getByRole('button', { name: 'Fri 2 Oct \u00b7 21:00' }) as HTMLButtonElement).disabled).toBe(false);
});
