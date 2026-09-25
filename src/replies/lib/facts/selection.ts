import { isEligibleForGeneration } from './eligibility';
import type { Fact } from './types';

/**
 * Picks a small set of eligible facts relevant to a piece of text.
 *
 * "No suitable fact" is a valid, expected outcome under C06: it means the
 * reply should use practical advice with no first-person claim, not that the
 * caller should widen the search until something matches. So this ranks by
 * plain tag/keyword overlap and enforces a minimum relevance floor, rather
 * than always returning the closest available fact.
 */

export interface SelectRelevantFactsOptions {
  queryText: string;
  limit: number;
}

/**
 * A shared token must be at least this long to count towards relevance.
 * Short, common words ("is", "to", "the") overlap between almost any two
 * pieces of text and would make an unrelated anecdote look relevant.
 */
const MIN_TOKEN_LENGTH = 3;

/**
 * Common English filler words long enough to pass the length filter above but
 * still meaningless as a signal of topic overlap ("for", "any", "new"...). A
 * fact about an unrelated topic can easily share one of these with a query,
 * and that accidental overlap must not count as relevance.
 */
const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'was', 'were', 'has', 'have', 'had', 'not',
  'any', 'all', 'some', 'new', 'made', 'that', 'this', 'these', 'those',
  'with', 'from', 'about', 'into', 'over', 'under', 'than', 'then', 'them',
  'you', 'your', 'our', 'their', 'his', 'her', 'its', 'can', 'will', 'what',
  'who', 'how', 'why', 'when', 'where', 'tips', 'help',
]);

/**
 * At least this many meaningful tokens must overlap before a fact counts as
 * relevant. Zero is not a usable floor: it would let the ranking fall back to
 * an arbitrary eligible fact just to fill a slot, which is exactly what C06
 * forbids.
 */
const MIN_RELEVANCE = 1;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= MIN_TOKEN_LENGTH && !STOPWORDS.has(token));
}

function relevance(fact: Fact, queryTokens: ReadonlySet<string>): number {
  const factTokens = new Set([...tokenize(fact.fact_text), ...fact.tags.flatMap(tokenize)]);
  let score = 0;
  for (const token of factTokens) {
    if (queryTokens.has(token)) score += 1;
  }
  return score;
}

/**
 * `now` is a required argument, not `new Date()` read internally, so a caller
 * can prove which facts were relevant on a given day without depending on the
 * system clock at test time.
 */
export function selectRelevantFacts(
  facts: readonly Fact[],
  options: SelectRelevantFactsOptions,
  now: Date,
): Fact[] {
  const queryTokens = new Set(tokenize(options.queryText));
  if (queryTokens.size === 0 || options.limit <= 0) return [];

  return facts
    .filter((fact) => isEligibleForGeneration(fact, now))
    .map((fact) => ({ fact, score: relevance(fact, queryTokens) }))
    .filter(({ score }) => score >= MIN_RELEVANCE)
    .sort((a, b) => b.score - a.score)
    .slice(0, options.limit)
    .map(({ fact }) => fact);
}

