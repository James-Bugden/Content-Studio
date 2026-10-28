/**
 * Shared lexical helpers for the suggestion searches (#245).
 *
 * Finding suggestions is free by design: no model call, no embedding. It is plain
 * token overlap, which is predictable and cheap enough to run on every click of
 * Get reply ideas. Latin text is split on word boundaries; Han text has no spaces,
 * so it is covered with overlapping bigrams.
 */

const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'was', 'were', 'has', 'have', 'had', 'not', 'any', 'all', 'some',
  'new', 'made', 'that', 'this', 'these', 'those', 'with', 'from', 'about', 'into', 'over',
  'than', 'then', 'them', 'you', 'your', 'our', 'their', 'his', 'her', 'its', 'can', 'will',
  'what', 'who', 'how', 'why', 'when', 'where', 'just', 'like', 'more', 'most', 'does', 'did',
]);

const HAN = /\p{Script=Han}/u;

/** Bounds a query so a pasted essay cannot become an unbounded search. */
export const MAX_QUERY_TOKENS = 24;

export function normaliseForSearch(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const chunk of normaliseForSearch(text).split(' ')) {
    if (chunk === '') continue;
    if (HAN.test(chunk)) {
      const chars = [...chunk];
      if (chars.length === 1) out.push(chunk);
      for (let i = 0; i < chars.length - 1; i += 1) out.push(chars[i]! + chars[i + 1]!);
    } else if (chunk.length >= 3 && !STOPWORDS.has(chunk)) {
      out.push(chunk);
    }
  }
  return out;
}

/** Distinct query tokens, in first-seen order, capped. */
export function queryTokens(text: string): string[] {
  return [...new Set(tokenize(text))].slice(0, MAX_QUERY_TOKENS);
}

/** Counts how many query tokens a field contains. */
export function overlap(tokens: readonly string[], haystack: string): number {
  if (tokens.length === 0 || haystack === '') return 0;
  const hay = normaliseForSearch(haystack);
  let hits = 0;
  for (const token of tokens) if (hay.includes(token)) hits += 1;
  return hits;
}

export function squash(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** A bounded excerpt, cut on a word boundary where there is one. */
export function excerpt(text: string, max: number): string {
  const flat = squash(text);
  const chars = [...flat];
  if (chars.length <= max) return flat;
  const cut = chars.slice(0, max).join('');
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}...`;
}
