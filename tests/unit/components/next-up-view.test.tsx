// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

import { NextUpView } from '@/components/home/next-up-view';
import type { PostSummary, Task } from '@/domain/board';

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
  it('does not call a Typefully recovery action Ready or an open slot To review', () => {
    render(<NextUpView today="2026-09-30" counts={counts} posts={[]} tasks={[
      task({ key: 'error', step: { kind: 'send_to_typefully', action: 'Check Typefully', why: 'Typefully reported an error.', urgency: 'now' } }),
      task({ key: 'open', step: { kind: 'fill_slot', action: 'Fill slot', why: 'Pick a Ready post.', urgency: 'soon' } }),
    ]} />);
    const error = within(document.querySelector('[data-task="error"]') as HTMLElement);
    expect(error.queryByText('Ready')).toBeNull();
    expect(error.getByText('Needs action')).toBeTruthy();
    const open = within(document.querySelector('[data-task="open"]') as HTMLElement);
    expect(open.getByText('Open slot')).toBeTruthy();
    expect(open.queryByText('To review')).toBeNull();
  });
  it('keeps urgent work first and distinguishes genuine blockers from ordinary review', () => {
    const tasks = [
      task({ key: 'urgent', target: { post: 'SYN-BLOCKED' }, step: { kind: 'fix_copy', action: 'Rework copy', why: 'Copyright needs rework.', urgency: 'now' } }),
      task({ key: 'review', target: { post: 'SYN-REVIEW' } }),
      task({ key: 'image', step: { kind: 'approve_image', action: 'Approve image', why: 'Review the image.', urgency: 'soon' } }),
      task({ key: 'ready', step: { kind: 'schedule', action: 'Schedule', why: 'All gates pass.', urgency: 'soon' } }),
    ];
    const post = { libraryId: 'SYN-BLOCKED', status: 'blocked', thumb: { src: null, tone: 'none', label: 'Text only' } } as PostSummary;
    render(<NextUpView today="2026-09-30" counts={counts} tasks={tasks} posts={[post]} />);
    expect(document.querySelector('[data-task]')?.getAttribute('data-task')).toBe('urgent');
    expect(within(document.querySelector('[data-task="urgent"]') as HTMLElement).getByText('Blocked')).toBeTruthy();
    expect(within(document.querySelector('[data-task="review"]') as HTMLElement).queryByText('Blocked')).toBeNull();
    expect(screen.getByRole('heading', { name: /Finish visuals/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Ready & schedule/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /^Schedule:/ }).getAttribute('href')).toContain('post=SYN-L001');
  });
  it('bounds urgent tasks as well as upcoming tasks and pages without losing totals', () => {
    const tasks = Array.from({ length: 2000 }, (_, i) => task({ key: `post:${i}`, title: `Task ${i}`, step: { kind: 'review', action: 'Review', why: 'Review copy', urgency: i < 1000 ? 'now' : 'soon' } }));
    render(<NextUpView today="2026-09-30" counts={counts} tasks={tasks} posts={[]} nowPage={2} nextPage={84} />);
    expect(document.querySelectorAll('[data-task]')).toHaveLength(16);
    expect(screen.queryByText('Task 0')).toBeNull();
    expect(screen.getByText('Task 12')).toBeTruthy();
    expect(screen.getByText('Task 1999')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Do these now (1000)' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Next (1000)' })).toBeTruthy();
    const urgent = within(screen.getByRole('navigation', { name: 'Urgent task pages' }));
    expect(urgent.getByRole('link', { name: 'Previous page' }).getAttribute('href')).toBe('/?nextPage=84&nowPage=1');
    expect(urgent.getByRole('link', { name: 'Next page' }).getAttribute('href')).toBe('/?nextPage=84&nowPage=3');
    const next = within(screen.getByRole('navigation', { name: 'Next task pages' }));
    expect(next.getByRole('link', { name: 'Previous page' }).getAttribute('href')).toBe('/?nowPage=2&nextPage=83');
    expect(next.queryByRole('link', { name: 'Next page' })).toBeNull();
  });
  it('shows the four tiles with counts and a calm check for zero', () => {
    render(<NextUpView today="2026-09-30" counts={counts} tasks={[]} posts={[]} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Next up' })).toBeTruthy();
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
    expect(screen.getByRole('navigation', { name: 'Next task pages' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Next page' }).getAttribute('href')).toBe('/?nowPage=1&nextPage=2');
    expect(document.querySelectorAll('[data-task]')).toHaveLength(13);
    expect(document.body.textContent).not.toContain('SYN-P');
  });
});
