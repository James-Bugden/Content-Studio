/**
 * Deterministic, isomorphic fingerprints (FNV-1a 64-bit).
 *
 * Used for row fingerprints, section hashes, approval stamps and redacted log
 * targets. This is change detection, not security: nothing here protects a secret.
 * It runs identically in Node, the edge runtime and the browser.
 */
const OFFSET = 0xcbf29ce484222325n;
const PRIME = 0x100000001b3n;
const MASK = 0xffffffffffffffffn;

export function fingerprint(input: string): string {
  let hash = OFFSET;
  const bytes = new TextEncoder().encode(input);
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * PRIME) & MASK;
  }
  return hash.toString(16).padStart(16, '0');
}

/** Fingerprint of an ordered list of values, unambiguous about boundaries. */
export function fingerprintValues(values: readonly unknown[]): string {
  return fingerprint(JSON.stringify(values.map((v) => (v === undefined || v === null ? '' : v))));
}

/** Short stamp stored in Sheet cells, e.g. approval stamps. */
export function shortHash(input: string): string {
  return fingerprint(input).slice(0, 8);
}
