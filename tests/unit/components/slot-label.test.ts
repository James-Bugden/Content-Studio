import { expect, it } from 'vitest';
import { slotLabel } from '@/domain/slot-label';

it.each(['', 'No time', 'Not set', 'TBD'])('omits an unset time (%s) from the confirm label', (time) => {
  expect(slotLabel('2026-10-01', time)).toBe('Thu 1 Oct');
});

it('keeps the real Taipei time in the confirm label', () => {
  expect(slotLabel('2026-10-01', '21:00')).toBe('Thu 1 Oct · 21:00');
});
