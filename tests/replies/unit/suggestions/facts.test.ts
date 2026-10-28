import { describe, expect, it } from 'vitest';
import { suggestFacts, toSuggestedFact, type SuggestableFact } from '@/replies/lib/suggestions/facts';
import { isEligibleForGeneration, isEligibleForSuggestion } from '@/replies/lib/facts/eligibility';
import { selectRelevantFacts } from '@/replies/lib/facts/selection';
import type { Fact } from '@/replies/lib/facts/types';

const now = new Date('2026-06-15T12:00:00Z');

const fact = (overrides: Partial<SuggestableFact> & { id: string }): SuggestableFact => ({
  fact_text: 'I reviewed several hundred cover letters while hiring.',
  tags: ['cover letter'],
  sensitivity: 'public_safe',
  approved: true,
  active: true,
  valid_from: null,
  valid_to: null,
  ...overrides,
});

describe('fact suggestions (#245)', () => {
  it('offers a private fact with a private tag instead of hiding it', () => {
    const found = suggestFacts({
      facts: [fact({ id: 'private-one', sensitivity: 'private_context_only' })],
      queryText: 'Does a cover letter matter?',
      now,
    });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ id: 'private-one', private: true });
  });

  it('still never offers an unapproved, switched-off or out-of-date fact', () => {
    const found = suggestFacts({
      facts: [
        fact({ id: 'unapproved', approved: false }),
        fact({ id: 'off', active: false }),
        fact({ id: 'expired', valid_to: '2026-01-01' }),
        fact({ id: 'future', valid_from: '2027-01-01' }),
        fact({ id: 'ok' }),
      ],
      queryText: 'cover letter advice',
      now,
    });
    expect(found.map((entry) => entry.id)).toEqual(['ok']);
  });

  it('shows the text of a fact an idea cites even when it is not a top match', () => {
    const found = suggestFacts({
      facts: [fact({ id: 'cited', fact_text: 'Something about negotiation.', tags: ['salary'] })],
      queryText: 'cover letter',
      explicitIds: ['cited'],
      now,
    });
    expect(found.map((entry) => entry.id)).toEqual(['cited']);
  });

  it('does not let an explicit id bypass eligibility', () => {
    const found = suggestFacts({
      facts: [fact({ id: 'cited', approved: false })],
      queryText: 'cover letter',
      explicitIds: ['cited'],
      now,
    });
    expect(found).toEqual([]);
  });

  it('bounds the text it sends', () => {
    expect(toSuggestedFact({ id: 'x', fact_text: 'word '.repeat(500), sensitivity: 'public_safe' }).text.length).toBeLessThan(310);
  });

  it('leaves generation untouched: private facts are still excluded there', () => {
    const privateFact = fact({ id: 'p', sensitivity: 'private_context_only' }) as unknown as Fact;
    expect(isEligibleForGeneration(privateFact, now)).toBe(false);
    expect(isEligibleForSuggestion(privateFact, now)).toBe(true);
    expect(selectRelevantFacts([privateFact], { queryText: 'cover letter', limit: 3 }, now)).toEqual([]);
    expect(selectRelevantFacts([privateFact], { queryText: 'cover letter', limit: 3, includePrivate: true }, now)).toHaveLength(1);
  });
});
