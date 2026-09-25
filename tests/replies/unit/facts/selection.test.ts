import { describe, it, expect } from 'vitest';
import { selectRelevantFacts } from '@/replies/lib/facts/selection';
import type { Fact } from '@/replies/lib/facts/types';

/**
 * All fixtures are synthetic invented examples, never real anecdotes.
 */

const NOW = new Date('2026-09-22T09:00:00Z');

function eligibleFact(overrides: Partial<Fact> = {}): Fact {
  return {
    id: 'fact-0000',
    user_id: 'owner-0000',
    fact_text: 'Rebuilt the onboarding flow for a synthetic project called Widgetline.',
    tags: ['onboarding', 'product'],
    source_reference: {},
    approved: true,
    sensitivity: 'public_safe',
    active: true,
    valid_from: null,
    valid_to: null,
    version: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('selectRelevantFacts', () => {
  it('selects a fact whose tags and text overlap the query', () => {
    const relevant = eligibleFact({
      id: 'fact-onboarding',
      fact_text: 'Redesigned onboarding for Widgetline, cutting drop-off in the first session.',
      tags: ['onboarding', 'retention'],
    });

    const result = selectRelevantFacts(
      [relevant],
      { queryText: 'Any tips for improving new user onboarding?', limit: 3 },
      NOW,
    );

    expect(result).toEqual([relevant]);
  });

  it('never selects an unrelated fact even when it is the only eligible one', () => {
    const unrelated = eligibleFact({
      id: 'fact-unrelated',
      fact_text: 'Ran a synthetic charity bake sale that raised a small amount for a made-up cause.',
      tags: ['volunteering', 'community'],
    });
    const ineligible = eligibleFact({
      id: 'fact-ineligible',
      approved: false,
      fact_text: 'Something about onboarding a new synthetic team.',
      tags: ['onboarding'],
    });

    const result = selectRelevantFacts(
      [unrelated, ineligible],
      { queryText: 'Any tips for improving new user onboarding?', limit: 3 },
      NOW,
    );

    expect(result).toEqual([]);
  });

  it('respects the limit even when more facts are relevant', () => {
    const facts = [
      eligibleFact({ id: 'fact-a', fact_text: 'Onboarding experiment A for Widgetline users.', tags: ['onboarding'] }),
      eligibleFact({ id: 'fact-b', fact_text: 'Onboarding experiment B for Widgetline users.', tags: ['onboarding'] }),
      eligibleFact({ id: 'fact-c', fact_text: 'Onboarding experiment C for Widgetline users.', tags: ['onboarding'] }),
    ];

    const result = selectRelevantFacts(facts, { queryText: 'Widgetline onboarding experiment', limit: 2 }, NOW);

    expect(result).toHaveLength(2);
  });

  it('returns an empty array for empty input', () => {
    expect(selectRelevantFacts([], { queryText: 'onboarding', limit: 3 }, NOW)).toEqual([]);
  });

  it('returns an empty array when the query has no meaningful tokens', () => {
    const facts = [eligibleFact()];
    expect(selectRelevantFacts(facts, { queryText: 'to a of', limit: 3 }, NOW)).toEqual([]);
  });

  it('excludes an eligible but irrelevant fact from a mixed set, keeping only the relevant one', () => {
    const relevant = eligibleFact({
      id: 'fact-relevant',
      fact_text: 'Shipped an onboarding redesign for Widgetline.',
      tags: ['onboarding'],
    });
    const irrelevant = eligibleFact({
      id: 'fact-irrelevant',
      fact_text: 'Trained for a synthetic marathon on weekends.',
      tags: ['fitness'],
    });

    const result = selectRelevantFacts(
      [irrelevant, relevant],
      { queryText: 'What helped with onboarding at Widgetline?', limit: 3 },
      NOW,
    );

    expect(result).toEqual([relevant]);
  });
});

