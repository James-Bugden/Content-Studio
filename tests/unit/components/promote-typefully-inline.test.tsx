// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PromoteConfirm } from '@/components/schedule/promote-confirm';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); push.mockReset(); });

const row = { contentId: '2026-10-01-MAIN-X', platform: 'X', platformRaw: 'X', slot: 'MAIN', revision: 'r', zh: null };
const slotData = (panel: unknown, extra: Record<string, unknown> = {}) => ({
  ok: true,
  data: { slot: { platform: 'X', slot: 'MAIN', time: '21:00', statusLabel: 'Scheduled' }, typefully: { row: { ...row, ...extra }, panel }, typefullyError: null, canEdit: true },
});

function stub(panelData: unknown) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/schedule/promote') return Response.json({ ok: true, replayed: false, contentId: row.contentId });
    if (url.startsWith('/api/panel/slot/')) return Response.json(panelData);
    throw new Error(`unexpected ${url}`);
  }));
}
const confirm = () => {
  render(<PromoteConfirm libraryId="SYN-L005" contentId={row.contentId} slotLabel="Thu 1 Oct" libraryRevision="a" scheduleRevision="b" />);
  fireEvent.click(screen.getByRole('button', { name: /Confirm and write/ }));
};

it('shows the slot summary and Create draft inline, keeping Open the schedule as a link', async () => {
  stub(slotData({ kind: 'no_match', row: { plannedAt: null }, searched: true }));
  confirm();
  await screen.findByText(/Scheduled into 2026-10-01-MAIN-X/);
  expect(await screen.findByText('X MAIN')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Create a planned draft in Typefully' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Link this draft/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Open the schedule' }));
  expect(push).toHaveBeenCalledWith('/schedule');
});

it('offers Link only when a draft matches, and shows the Chinese adaptation blocker with its link', async () => {
  stub(slotData(
    { kind: 'single_match', row: { plannedAt: null }, candidate: { draftId: 'D1', date: null, time: null, slot: null, platform: 'X', platforms: ['X'], multiPlatform: false, status: 'draft', deltaMinutes: null, similarity: 0.9, text: 'x' } },
    { platform: 'Threads', zh: { state: 'missing', xContentId: '2026-10-01-MAIN-X' } },
  ));
  confirm();
  expect(await screen.findByRole('button', { name: 'Link this draft' })).toBeTruthy();
  expect(screen.getByText(/Chinese adaptation is not adapted yet/)).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Open the Threads adaptation' }).getAttribute('href')).toBe('/schedule/2026-10-01-MAIN-X/adapt');
});

it('degrades to one quiet line when Typefully cannot be checked', async () => {
  stub({ ok: false });
  confirm();
  expect(await screen.findByText(/Typefully could not be checked/)).toBeTruthy();
});
