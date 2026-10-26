import 'server-only';

export const CONTENT_TIMESTAMP_FIELDS = new Set(['finalSyncedAt', 'publishedAt', 'analyticsSyncedAt']);
/** Internal metadata, never an exported unknown Sheet column. */
export const FINAL_SYNCED_AT_RAW_KEY = '@final_synced_at';

/** Date.parse normalizes impossible days. Check the written calendar first. */
function validCalendarStamp(stamp: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(stamp);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText = '0', fraction = '', offsetHour = '0', offsetMinute = '0'] = match;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  const hour = Number(hourText), minute = Number(minuteText), second = Number(secondText);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]!) return false;
  if (minute > 59 || second > 59 || Number(offsetHour) > 23 || Number(offsetMinute) > 59) return false;
  // Preserve the existing ISO end-of-day policy: only precisely 24:00 is valid.
  if (hour > 24 || hour === 24 && (minute !== 0 || second !== 0 || /[1-9]/.test(fraction))) return false;
  return Number.isFinite(Date.parse(stamp));
}

/** Timestamp cells may carry an exact final-copy hash, never arbitrary text. */
export function contentTimestampParts(text: string, field: string): { stamp: string; hash: string } | null {
  if (!CONTENT_TIMESTAMP_FIELDS.has(field)) return null;
  const parts = field === 'finalSyncedAt' ? text.split(' #') : [text];
  const [stamp = '', hash = ''] = parts;
  if (parts.length > 2 || parts.length === 2 && (!stamp || !hash)) return null;
  if (stamp && !validCalendarStamp(stamp)) return null;
  return { stamp, hash };
}

export function sameContentTimestamp(left: string, right: string, field: string): boolean {
  const a = contentTimestampParts(left, field), b = contentTimestampParts(right, field);
  if (!a?.stamp || !b?.stamp || a.hash !== b.hash) return false;
  // Date.parse truncates sub-millisecond digits. Compare the fractional part
  // separately so two genuinely different instants cannot become equivalent.
  const instant = (stamp: string) => {
    const fraction = /\.(\d+)(?=Z|[+-])/.exec(stamp)?.[1] ?? '';
    return [Date.parse(stamp.replace(/\.\d+(?=Z|[+-])/, '')), fraction.replace(/0+$/, '')] as const;
  };
  const x = instant(a.stamp), y = instant(b.stamp);
  return x[0] === y[0] && x[1] === y[1];
}

/** Render the operational timezone without losing PostgreSQL fractional digits. */
export function taipeiContentTimestamp(stamp: string): string | null {
  if (!contentTimestampParts(stamp, 'publishedAt')) return null;
  if (!stamp) return '';
  const fraction = /\.(\d+)(?=Z|[+-])/.exec(stamp)?.[1]?.replace(/0+$/, '') ?? '';
  const seconds = Date.parse(stamp.replace(/\.\d+(?=Z|[+-])/, ''));
  return new Date(seconds + 8 * 3600_000).toISOString().replace(/\.000Z$/, `${fraction ? `.${fraction}` : ''}+08:00`);
}
