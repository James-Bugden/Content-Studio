import { createHash } from 'node:crypto';

/**
 * Exact text and search text are different things and are never allowed to become
 * the same thing.
 *
 * `final_text` is what the owner submitted, byte for byte. Nothing in this module
 * returns a modified version of it. `searchText()` produces a separate normalised
 * copy for indexing, and `contentHash()` identifies the exact text so a stale
 * embedding job can be recognised and discarded (C04, C05, C09).
 */

/** SHA-256 of the exact text, as submitted. Not normalised, not trimmed. */
export function contentHash(exactText: string): string {
  return createHash('sha256').update(exactText, 'utf8').digest('hex');
}

/**
 * The normalised copy used for lexical search only.
 *
 * NFC so that composed and decomposed Chinese or accented Latin match; line
 * endings unified; runs of whitespace collapsed; lower-cased. Chinese is left
 * unsegmented: trigram matching handles it, and a wrong segmentation is worse
 * than none.
 */
export function searchText(exactText: string): string {
  return exactText
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('en');
}

/**
 * A stable fingerprint of a submitted operation payload.
 *
 * C09 is explicit that the idempotency key is a stable operation UUID and the
 * fingerprint is derived from the payload: same key plus same fingerprint replays,
 * same key plus a different fingerprint is a conflict. Key ordering is normalised
 * so that an equivalent payload does not produce a spurious conflict.
 */
export function payloadFingerprint(payload: unknown): string {
  return createHash('sha256').update(stableStringify(payload), 'utf8').digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

/** Counts user-perceived characters, so an emoji is one unit rather than two. */
export function codePointLength(text: string): number {
  return [...text].length;
}

/**
 * Whether the text contains Han characters. Used to pick a font stack and to
 * decide whether an English review meaning is worth offering, never to decide
 * what language the owner *meant*.
 */
export function containsHan(text: string): boolean {
  return /\p{Script=Han}/u.test(text);
}

