// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AppShell, PRIMARY_NAV } from '@/components/app-shell';
import { StatusBanner } from '@/components/shell-status';
import { CapabilityBanner } from '@/components/capability-banner';
import { StaleBacklogBanner } from '@/components/backlog/stale-backlog-banner';
import { LinkedInLogo, ThreadsLogo, XLogo } from '@/components/platform-logos';

const route = vi.hoisted(() => ({ pathname: '/review/post/example' }));
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname, useRouter: () => ({ push: vi.fn() }) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function shell(children?: React.ReactNode) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ nextUp: 4, fixIssues: 2, expiresAt: Date.now() + 15000 }) }));
  return render(<AppShell accountSlot={<button>Sign out</button>}>{children}</AppShell>);
}

it('retains every destination, nested active state, counts and accessible collapsed links', async () => {
  const { container } = shell(<p>Page content</p>);
  const nav = screen.getByRole('navigation', { name: 'Primary' });
  expect(PRIMARY_NAV.map(i => i.label)).toEqual(['Next up', 'Posts', 'Calendar', 'Backlog', 'Published', 'Fix issues', 'Replies']);
  expect(within(nav).getByRole('link', { name: 'Posts' }).getAttribute('aria-current')).toBe('page');
  await within(nav).findByText('4');
  fireEvent.click(screen.getByRole('button', { name: 'Collapse navigation' }));
  expect(container.querySelector('.studio-shell')?.getAttribute('data-collapsed')).toBe('true');
  expect(screen.getByRole('button', { name: 'Expand navigation' }).getAttribute('aria-expanded')).toBe('false');
  expect(within(nav).getByRole('link', { name: 'Posts' }).getAttribute('href')).toBe('/review');
  fireEvent.click(screen.getByRole('button', { name: 'Expand navigation' }));
  expect(container.querySelector('.studio-shell')?.getAttribute('data-collapsed')).toBe('false');
});

it('puts capability and stale-read messages under the topbar, and removes page warnings on unmount', () => {
  const warnings = <>
    <StatusBanner kind="capability"><CapabilityBanner capabilities={[{ provider: 'drive', state: 'read_only', mode: 'fake' }]} /></StatusBanner>
    <StaleBacklogBanner readAt={0} retryHref="/backlog?platform=X" />
  </>;
  const { rerender, container } = shell(warnings);
  const slot = screen.getByTestId('shell-status');
  expect(within(slot).getByRole('region', { name: 'Integration status' }).textContent).toContain('Google Drive read-only');
  expect(within(slot).getByText(/Editing and saving are disabled/)).toBeTruthy();
  expect(within(slot).getByRole('link', { name: 'Retry' }).getAttribute('href')).toBe('/backlog?platform=X');
  expect(screen.getByRole('main').textContent).toBe('');
  expect(container.querySelector('.studio-topbar')?.nextElementSibling).toBe(slot);
  rerender(<AppShell><p>Another page</p></AppShell>);
  expect(slot.textContent).toBe('');
  expect(screen.getByRole('main').textContent).toBe('Another page');
});

it('keeps sign-out in the account disclosure and returns focus on Escape', () => {
  shell();
  const summary = screen.getByText('CS', { selector: '.studio-avatar span' }).closest('summary')!;
  const details = summary.closest('details')!;
  details.open = true;
  expect(within(details).getByRole('button', { name: 'Sign out' })).toBeTruthy();
  fireEvent.keyDown(details, { key: 'Escape' });
  expect(details.open).toBe(false);
  expect(document.activeElement).toBe(summary);
});

it('uses openly licensed brand paths, decorative defaults and explicit brand colours', () => {
  const { container } = render(<><XLogo /><LinkedInLogo /><ThreadsLogo /></>);
  const logos = Array.from(container.querySelectorAll('svg'));
  expect(logos).toHaveLength(3);
  expect(logos.map(svg => svg.querySelector('path')?.getAttribute('fill'))).toEqual(['#000000', '#0A66C2', '#000000']);
  expect(logos.every(svg => svg.getAttribute('aria-hidden') === 'true' && svg.getAttribute('focusable') === 'false')).toBe(true);
  expect(logos.every(svg => (svg.querySelector('path')?.getAttribute('d')?.length ?? 0) > 100)).toBe(true);
});
