/** Internal DB metadata; Sheet passthrough entries use numeric column keys. */
export const CONTENT_ANGLE_RAW_KEY = '@content_angle';

/** Accept only the numbered Content Angle vocabulary, preserving text elsewhere. */
export function numberedContentAngle(text: string): number | null {
  const match = /^\s*(\d{1,2})\.\s*(\S.*)$/.exec(text);
  if (!match) return null;
  const angle = Number(match[1]);
  return angle >= 1 && angle <= 14 ? angle : null;
}
