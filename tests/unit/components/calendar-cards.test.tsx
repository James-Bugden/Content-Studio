// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { StatusLine, ListSlotCard } from '@/components/calendar/slot-card';
import type { SlotSummary } from '@/domain/board';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => '/schedule', useSearchParams: () => new URLSearchParams('view=list&week=2026-09-28'),
}));
afterEach(cleanup);
const slot: SlotSummary = {
  contentId: '2026-10-01-MAIN-X', isoDate: '2026-10-01', slot: 'MAIN', platform: 'X', time: '08:00',
  hook: 'A compact\npost title', statusLabel: 'Ready', empty: false, expectedPillar: null,
  thumb: null, libraryId: null, parentContentId: '',
  step: { kind: 'send_to_typefully', action: 'Send to Typefully', why: 'Ready to send.', urgency: 'soon' },
};

it.each(['Ready', 'Scheduled', 'Published'])('keeps %s explicit rather than calling it in review', statusLabel => {
  render(<StatusLine slot={{ ...slot, statusLabel }} />);
  expect(screen.getByText(statusLabel)).toBeTruthy();
  expect(screen.queryByText('In review')).toBeNull();
});

it('keeps an urgent action visible beside the existing publication status and preserves the panel URL', () => {
  render(<ListSlotCard slot={{ ...slot, statusLabel: 'Scheduled', step: { kind: 'update_chinese', action: 'Update Chinese', why: 'X changed.', urgency: 'now' } }} past={false} />);
  expect(screen.getByText('Scheduled')).toBeTruthy();
  expect(screen.getByText('Update Chinese')).toBeTruthy();
  const link = screen.getByRole('link');
  expect(link.getAttribute('href')).toBe('/schedule?view=list&week=2026-09-28&slot=2026-10-01-MAIN-X');
  expect(link.querySelector('svg path')?.getAttribute('fill')).toBe('#000000');
});
