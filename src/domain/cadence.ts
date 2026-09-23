import type { Platform, Slot } from './enums';
import type { WorkflowSettings } from './records';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

function weekdayOf(isoDate: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.toISOString().slice(0, 10) !== isoDate) return null;
  return WEEKDAYS[date.getUTCDay()] ?? null;
}

/**
 * Expected content pillar for one active schedule slot.
 *
 * The policy is read from Workflow Settings, not duplicated in application code.
 * Example row:
 * Tuesday cadence =
 * X/Threads AM: Social proof | PM: Expertise | LinkedIn: Build in public (Soar)
 */
export function expectedPillar(
  settings: WorkflowSettings,
  isoDate: string,
  platform: Platform,
  slot: Slot,
): string | null {
  if (slot === '3rd') return null;
  const weekday = weekdayOf(isoDate);
  if (!weekday) return null;
  const rule = settings.raw[`${weekday} cadence`]?.trim();
  if (!rule) return null;

  if (platform === 'LinkedIn') {
    if (slot !== 'Main') return null;
    return rule.match(/(?:^|\|)\s*LinkedIn:\s*(.+?)\s*$/i)?.[1]?.trim() || null;
  }

  const label = slot === 'Main' ? 'AM' : 'PM';
  const match = rule.match(label === 'AM' ? /X\/Threads\s+AM:\s*([^|]+)/i : /(?:^|\|)\s*PM:\s*([^|]+)/i);
  return match?.[1]?.trim() || null;
}
