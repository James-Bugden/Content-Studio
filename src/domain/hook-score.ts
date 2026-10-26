/** Internal DB metadata, never an exported unknown Sheet column. */
export const HOOK_SCORE_RAW_KEY = '@hook_score';

/** ASCII decimal cells only; trim for parsing, never for preserved Sheet text. */
export function decimalHookScore(text: string): number | null {
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(text.trim())) return null;
  const score = Number(text.trim());
  return Math.abs(score) < 1000 ? score : null;
}
