// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AppShell } from '@/components/app-shell';
import { NavigationBadge } from '@/components/navigation-counts';

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
vi.mock('@/components/nav-link', () => ({
  NavLink: ({ href, children }: { href: string; children: React.ReactNode }) =>
    <a href={href}>{children}<NavigationBadge href={href} /></a>,
}));
vi.mock('@/components/nav-more', () => ({ NavMore: () => null }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('updates navigation without propagating counts context into the streamed page', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({
    nextUp: 3, fixIssues: null, expiresAt: Date.now() + 15_000,
  }) }));
  // A page consumer detects a widened context boundary even if its descendants
  // happen to be fully hydrated in this component test.
  render(<AppShell><p>Page content</p><NavigationBadge href="/" /></AppShell>);
  const nav = screen.getByRole('navigation', { name: 'Primary' });
  await within(nav).findByText('3');
  expect(screen.getByRole('main').querySelector('[data-nav-count]')).toBeNull();
  expect(screen.getAllByRole('main')).toHaveLength(1);
});
