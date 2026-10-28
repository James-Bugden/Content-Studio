import { SUGGESTION_LIMITS, type SuggestedFact } from '@/replies/lib/contracts/api';
import { isEligibleForSuggestion } from '@/replies/lib/facts/eligibility';
import { selectRelevantFacts } from '@/replies/lib/facts/selection';
import type { Fact } from '@/replies/lib/facts/types';
import { excerpt } from './text';

/**
 * Fact suggestions (#245). Same free lexical selection the draft uses, with one
 * deliberate difference: a private_context_only fact is offered, tagged "private",
 * instead of silently hidden. Approval, active and the validity window still gate it.
 */

export type SuggestableFact = Pick<Fact, 'id' | 'fact_text' | 'sensitivity' | 'tags' | 'approved' | 'active' | 'valid_from' | 'valid_to'>;

export function toSuggestedFact(fact: Pick<Fact, 'id' | 'fact_text' | 'sensitivity'>): SuggestedFact {
  return {
    id: fact.id,
    text: excerpt(fact.fact_text, SUGGESTION_LIMITS.factChars),
    private: fact.sensitivity !== 'public_safe',
  };
}

export function suggestFacts(args: {
  facts: readonly SuggestableFact[];
  queryText: string;
  /** Ids an idea already cites, so their text can be shown even when not a top match. */
  explicitIds?: readonly string[];
  now: Date;
  limit?: number;
}): SuggestedFact[] {
  const limit = args.limit ?? SUGGESTION_LIMITS.facts;
  const explicit = new Set(args.explicitIds ?? []);
  const pool = args.facts as readonly Fact[];

  const cited = pool.filter((fact) => explicit.has(fact.id) && isEligibleForSuggestion(fact, args.now));
  const relevant = selectRelevantFacts(pool, { queryText: args.queryText, limit, includePrivate: true }, args.now);

  const seen = new Set<string>();
  const out: SuggestedFact[] = [];
  for (const fact of [...cited, ...relevant]) {
    if (seen.has(fact.id)) continue;
    seen.add(fact.id);
    out.push(toSuggestedFact(fact));
  }
  return out;
}
