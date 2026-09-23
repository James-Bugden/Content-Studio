/**
 * Deterministic text similarity for Typefully reconciliation (CS-015 TYPE-01/03).
 *
 * Token Jaccard over NFKC-lowercased text. Latin/number runs become word tokens;
 * CJK runs become overlapping character bigrams (a lone CJK character is its own
 * token), because Chinese has no spaces to split on. Punctuation, emoji and
 * whitespace are ignored, so whitespace-only or emoji-only differences still score
 * 1.0. That is intended: similarity only nominates candidates, it never decides
 * what text is written. Exact text comparison is done separately.
 */
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const TOKEN_RUN = /[\p{L}\p{N}]+/gu;

export function similarityTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  const normalised = text.normalize('NFKC').toLowerCase();
  for (const run of normalised.match(TOKEN_RUN) ?? []) {
    let latin = '';
    let cjk: string[] = [];
    const flushLatin = () => {
      if (latin) tokens.add(latin);
      latin = '';
    };
    const flushCjk = () => {
      if (cjk.length === 1) tokens.add(cjk[0]!);
      for (let i = 0; i + 1 < cjk.length; i += 1) tokens.add(cjk[i]! + cjk[i + 1]!);
      cjk = [];
    };
    for (const ch of run) {
      if (CJK.test(ch)) {
        flushLatin();
        cjk.push(ch);
      } else {
        flushCjk();
        latin += ch;
      }
    }
    flushLatin();
    flushCjk();
  }
  return tokens;
}

/** Jaccard similarity in [0, 1], rounded to 3 decimals. Two empty texts score 1. */
export function textSimilarity(a: string, b: string): number {
  const ta = similarityTokens(a);
  const tb = similarityTokens(b);
  if (ta.size === 0 && tb.size === 0) return 1;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  const union = ta.size + tb.size - shared;
  return union === 0 ? 0 : Math.round((shared / union) * 1000) / 1000;
}

/** Minimum similarity for an exact single-candidate match (TYPE-01). */
export const EXACT_MATCH_SIMILARITY = 0.9;
