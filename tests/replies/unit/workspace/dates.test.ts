import { describe, it, expect } from 'vitest';
import { localDayOf } from '@/replies/lib/workspace/dates';

/**
 * DAY-01, from the display side.
 *
 * The counter converts an instant into the configured timezone before taking a
 * date. Everything that *showed* a date was slicing the UTC string instead, so a
 * reply posted at 00:30 Taipei was counted as today and displayed as yesterday.
 * Two parts of one screen disagreeing about what day it is is worse than either
 * answer on its own.
 */

describe('the displayed day is the counting day', () => {
  it('agrees with the counter across the Taipei midnight boundary', () => {
    // 2026-03-10 15:59:59Z is 23:59:59 in Taipei on the 10th.
    expect(localDayOf('2026-03-10T15:59:59.000Z', null)).toBe('2026-03-10');
    // One second later it is the 11th there, and the counter says so too.
    expect(localDayOf('2026-03-10T16:00:00.000Z', null)).toBe('2026-03-11');
  });

  it('is the case that used to be wrong: late evening UTC, next morning Taipei', () => {
    // This is the whole bug. The UTC slice says the 22nd; Taipei is already the 23rd.
    expect(localDayOf('2026-09-22T23:30:00.000Z', null)).toBe('2026-09-23');
    expect(new Date('2026-09-22T23:30:00.000Z').toISOString().slice(0, 10)).toBe('2026-09-22');
  });

  it('does not depend on the machine running it', () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = 'America/Los_Angeles';
      expect(localDayOf('2026-09-22T23:30:00.000Z', null)).toBe('2026-09-23');
    } finally {
      process.env.TZ = original;
    }
  });

  it('returns a date-only value untouched rather than inventing a time for it', () => {
    // Converting it would require a time of day the source never supplied, which
    // is exactly the invention C04 forbids.
    expect(localDayOf(null, '2026-01-04')).toBe('2026-01-04');
    expect(localDayOf('2026-09-22T23:30:00.000Z', '2026-01-04')).toBe('2026-01-04');
  });

  it('says nothing when there is nothing to say', () => {
    expect(localDayOf(null, null)).toBeNull();
    expect(localDayOf('not a date', null)).toBeNull();
  });

  it('honours a different timezone when one is given', () => {
    expect(localDayOf('2026-09-22T23:30:00.000Z', null, 'UTC')).toBe('2026-09-22');
    expect(localDayOf('2026-09-22T23:30:00.000Z', null, 'Asia/Taipei')).toBe('2026-09-23');
  });
});

