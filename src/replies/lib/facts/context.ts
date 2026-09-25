import { isEligibleForGeneration } from './eligibility';
import type { Fact } from './types';

/**
 * The exact, minimal payload a fact may contribute to a generation provider:
 * an id and version a later semantic check can look up again, and the exact
 * text, never a paraphrase. Nothing else. In particular there is no
 * `source_reference` field here, because that is private (C06) and a
 * generation provider has no legitimate reason to see it.
 */
export interface FactContextEntry {
  fact_id: string;
  version: number;
  fact_text: string;
}

export interface FactContextOptions {
  now: Date;
}

/**
 * Builds what may be sent to a generation provider from a list of facts a
 * caller has already selected (typically via `selectRelevantFacts`).
 *
 * This re-checks eligibility itself rather than trusting the caller, because
 * a silent leak at this specific boundary sends private material to a third
 * party. Any ineligible fact reaching here is a bug upstream, so it throws
 * instead of quietly dropping the fact: dropping it would hide the bug behind
 * a context that merely looks a little short.
 *
 * Passing this ID back later is not proof that a model's wording faithfully
 * reflects the fact. That semantic check is issue #14's responsibility, not
 * this function's; this is only the seam it hooks into.
 */
export function buildFactContext(
  facts: readonly Fact[],
  options: FactContextOptions,
): FactContextEntry[] {
  return facts.map((fact) => {
    if (!isEligibleForGeneration(fact, options.now)) {
      throw new Error(
        `buildFactContext received an ineligible fact (id ${fact.id}); refusing rather than risk sending private material to a generation provider`,
      );
    }
    return {
      fact_id: fact.id,
      version: fact.version,
      fact_text: fact.fact_text,
    };
  });
}

