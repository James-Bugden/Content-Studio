// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
vi.mock('@/application/container', () => ({ getServices: () => ({ repo: {} }) }));
vi.mock('@/lib/auth', () => ({ requireActor: async () => ({ role: 'owner' }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams(), usePathname: () => '/ready' }));
vi.mock('@/application/schedule', () => ({ promotionContext: async () => ({ group: 'ready', options: [], library: { value: { slug: 'Synthetic', targetPlatform: { ok: true, value: 'LinkedIn' } } } }) }));
import PromotePage from '@/app/(studio)/ready/[libraryId]/promote/page';
afterEach(cleanup);
it('CS-059j: full-page fallback names the requested unusable slot', async () => {
  render(await PromotePage({ params: Promise.resolve({ libraryId: 'SYN-L005' }), searchParams: Promise.resolve({ slot: '2026-12-01-MAIN-LI' }) }));
  expect(screen.getByText('Tue 1 Dec \u00b7 LinkedIn \u00b7 Main: This slot cannot be used. Choose another slot.')).toBeTruthy();
});
