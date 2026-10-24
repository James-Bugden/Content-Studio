// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ load: vi.fn(), caps: vi.fn() }));
vi.mock('@/application/board', () => ({ loadBoard: mocks.load }));
vi.mock('@/application/container', () => ({ getServices: () => ({ repo: {} }) }));
vi.mock('@/application/capabilities', () => ({ capabilities: mocks.caps }));
vi.mock('@/lib/auth', () => ({ requireActor: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/', useSearchParams: () => new URLSearchParams() }));
import NextUpPage from '@/app/(studio)/page';

afterEach(() => { cleanup(); vi.resetAllMocks(); });

it.each([false, true])('Next up explains limited integrations even when the board fails: %s', async (failed) => {
  mocks.caps.mockReturnValue([{ provider: 'typefully', state: 'not_configured', mode: 'live' }, { provider: 'sheet', state: 'ready', mode: 'live' }]);
  if (failed) mocks.load.mockRejectedValue(new Error('Synthetic failure'));
  else mocks.load.mockResolvedValue({ today: '2026-09-30', counts: { review: 0, images: 0, ready: 0, openSlotsThisWeek: 0, problems: 0 }, tasks: [], posts: [] });
  render(await NextUpPage());
  expect(screen.getByRole('region', { name: 'Integration status' }).textContent).toContain('Typefully not configured: publishing actions are disabled; review still works');
  expect(screen.getByText('One integration is limited')).toBeTruthy();
});

it('does not show an integration warning when all capabilities are ready', async () => {
  mocks.caps.mockReturnValue([{ provider: 'typefully', state: 'ready', mode: 'fake' }]);
  mocks.load.mockResolvedValue({ today: '2026-09-30', counts: { review: 0, images: 0, ready: 0, openSlotsThisWeek: 0, problems: 0 }, tasks: [], posts: [] });
  render(await NextUpPage());
  expect(screen.queryByRole('region', { name: 'Integration status' })).toBeNull();
});
