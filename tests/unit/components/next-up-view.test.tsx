// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

import { NextUpView } from '@/components/home/next-up-view';
import type { Task } from '@/domain/board';

afterEach(cleanup);

const counts = { review: 2, images: 0, ready: 1, openSlotsThisWeek: 3, problems: 1 };
const task = (over: Partial<Task> & Pick<Task, 'key'>): Task => ({
  step: { kind: 'review', action: 'Review', why: 'Waiting for your review.', urgency: 'soon' },
  title: 'negotiate scope first',
  platform: 'LinkedIn',
  target: { post: 'SYN-L001' },
  ...over,
});

describe('Next up view (UX redesign)', () => {
  it('shows the four tiles with counts and a calm check for zero', () => {
    render(<NextUpView today="2026-09-30" counts={counts} tasks={[]} posts={[]} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Next up' })).toBeTruthy();
    expect(screen.getByText('Here is what needs you')).toBeTruthy();
    expect(screen.getByText('Wednesday 30 September 2026')).toBeTruthy();
    expect(screen.getByRole('link', { name: /^2\s*To review$/ }).getAttribute('href')).toBe('/review?lane=review');
    expect(screen.getByRole('link', { name: /Images to finish/ }).textContent).toContain('✓');
    expect(screen.getByRole('link', { name: /^3\s*Open slots this week$/ }).getAttribute('href')).toBe('/schedule');
  });

  it('shows the empty state when nothing needs doing', () => {
    render(<NextUpView today="2026-09-30" counts={counts} tasks={[task({ key: 'later', step: { kind: 'sync_published', action: 'Sync results', why: 'x', urgency: 'later' } })]} posts={[]} />);
    expect(screen.getByRole('heading', { name: "You're all caught up." })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /Do these now/ })).toBeNull();
  });

  it('lists urgent tasks first, with readable titles, platform, time and a panel button', () => {
    const tasks = [
      task({ key: 'slot:2026-10-02-MAIN-X', title: 'ask for the band.', platform: 'X', when: { isoDate: '2026-10-02', time: '08:00' }, target: { slot: '2026-10-02-MAIN-X' }, step: { kind: 'update_chinese', action: 'Update Chinese', why: 'The X copy changed.', urgency: 'now' } }),
      ...Array.from({ length: 14 }, (_, i) => task({ key: `post:${i}`, target: { post: `SYN-P${i}` } })),
    ];
    render(<NextUpView today="2026-09-30" counts={counts} tasks={tasks} posts={[]} />);
    const now = screen.getByRole('heading', { name: /Do these now/ }).closest('section')!;
    expect(within(now).getByText('Ask for the band.')).toBeTruthy();
    expect(within(now).getByText('X, Fri 2 Oct, 08:00')).toBeTruthy();
    expect(within(now).getByRole('link', { name: /^Update Chinese/ }).getAttribute('href')).toBe('/?slot=2026-10-02-MAIN-X');
    expect(screen.getByText('Show all (2 more)')).toBeTruthy();
    expect(document.body.textContent).not.toContain('SYN-P');
  });
});
