import 'server-only';

export const CONTENT_TIMESTAMP_FIELDS = new Set(['finalSyncedAt', 'publishedAt', 'analyticsSyncedAt']);

/** Timestamp cells may carry an exact final-copy hash, never arbitrary text. */
export function contentTimestampParts(text: string, field: string): { stamp: string; hash: string } | null {
  if (!CONTENT_TIMESTAMP_FIELDS.has(field)) return null;
  const parts = field === 'finalSyncedAt' ? text.split(' #') : [text];
  const [stamp = '', hash = ''] = parts;
  if (parts.length > 2 || parts.length === 2 && (!stamp || !hash)) return null;
  if (stamp && (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d\d:\d\d)$/.test(stamp) || !Number.isFinite(Date.parse(stamp)))) return null;
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
