// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
const mocks = vi.hoisted(() => ({ load: vi.fn(), push: vi.fn() }));
vi.mock('@/application/review', async original => ({ ...await original<typeof import('@/application/review')>(), loadReviewQueue: mocks.load }));
vi.mock('@/application/container', () => ({ getServices: () => ({ repo: { queueSummary: async () => [] } }) }));
vi.mock('@/application/capabilities', () => ({ capabilities: () => [] }));
vi.mock('@/lib/auth', () => ({ requireActor: async () => ({ role: 'owner' }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }), usePathname: () => '/review', useSearchParams: () => new URLSearchParams('lane=review&target=Threads&layout=cards') }));
import ReviewPage from '@/app/(studio)/review/page';
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it.each([0, 2])('CS-059g: unified result announcement at %s results', async total => {
  mocks.load.mockResolvedValue({ total, totalUnfiltered: 5, page: 1, pages: 1, cards: [], sources: [], laneCounts: {}, scheduleUnavailable: false });
  render(await ReviewPage({ searchParams: Promise.resolve({ lane: 'review', target: 'Threads', layout: 'cards' }) }));
  const live = document.querySelectorAll('[aria-live="polite"]');
  expect(live).toHaveLength(1);
  expect(live[0]!.textContent).toContain(total ? 'Showing 1 to 2 of 2 (filtered from 5)' : 'None of the 5 Library rows match these filters.');
});
it.each([0, 2])('CS-059g: one clear action resets filters and lane at %s results', async total => {
  mocks.load.mockResolvedValue({ total, totalUnfiltered: 5, page: 1, pages: 1, cards: [], sources: [], laneCounts: {}, scheduleUnavailable: false });
  render(await ReviewPage({ searchParams: Promise.resolve({ lane: 'review', target: 'Threads', layout: 'cards' }) }));
  const clear = [...screen.queryAllByRole('button', { name: /Clear (all )?filters/ }), ...screen.queryAllByRole('link', { name: 'Clear all filters' })];
  expect(clear).toHaveLength(1);
  if (!total) expect(clear[0]!.closest('[data-state="no_match"]')).toBeTruthy();
  if (total) {
    fireEvent.click(clear[0]!);
    expect(mocks.push.mock.calls[0]?.[0]).toBe('/review?layout=cards');
  } else expect(clear[0]!.getAttribute('href')).toBe('/review?layout=cards');
});

it('CS-059j: an empty Library retains a clear action', async () => {
  mocks.load.mockResolvedValue({ total: 0, totalUnfiltered: 0, page: 1, pages: 1, cards: [], sources: [], laneCounts: {} });
  render(await ReviewPage({ searchParams: Promise.resolve({ lane: 'review', target: 'Threads' }) }));
  expect(screen.getByRole('button', { name: 'Clear filters' })).toBeTruthy();
});
it('CS-059j: no-match clear removes every defined filter including queue', async () => {
  mocks.load.mockResolvedValue({ total: 0, totalUnfiltered: 5, page: 1, pages: 1, cards: [], sources: [], laneCounts: {} });
  render(await ReviewPage({ searchParams: Promise.resolve({ lane: 'review', target: 'Threads', review: 'Pending', src: 'synthetic', from: 'X', copyright: 'PASS', duplicate: 'PASS', queue: 'queued', page: '2', layout: 'cards' }) }));
  expect(screen.getByRole('link', { name: 'Clear all filters' }).getAttribute('href')).toBe('/review?layout=cards');
});

it.each([0, 5])('CS-059j: zero-result view has one explicit or implicit polite result region (Library total %s)', async totalUnfiltered => {
  mocks.load.mockResolvedValue({ total: 0, totalUnfiltered, page: 1, pages: 1, cards: [], sources: [], laneCounts: {} });
  render(await ReviewPage({ searchParams: Promise.resolve({ target: 'Threads' }) }));
  expect(document.querySelectorAll('[aria-live="polite"], [role="status"]:not([aria-live="off"])')).toHaveLength(1);
});
