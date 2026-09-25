import { APP } from '@/replies/lib/contracts/limits';

/**
 * Turning a recorded instant into the day the owner would call it.
 *
 * The counter already does this correctly, in SQL: it converts `posted_at` into
 * the configured timezone before taking a date. Everything that *displayed* a
 * date was slicing the UTC string instead, so a reply posted at 00:30 Taipei was
 * counted as today and shown as yesterday. That is the exact window the counter
 * exists to get right, and disagreeing with itself is worse than either answer.
 *
 * A date-only value is returned untouched. It has no time, so converting it
 * would invent one, and C04 is explicit that unknown precision stays unknown.
 */
export function localDayOf(
  postedAt: string | null,
  postedDate: string | null,
  timezone: string = APP.defaultTimezone,
): string | null {
  if (postedDate) return postedDate;
  if (!postedAt) return null;

  const instant = new Date(postedAt);
  if (Number.isNaN(instant.getTime())) return null;

  // en-CA gives an ISO-shaped date, which is what the rest of the app compares.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

