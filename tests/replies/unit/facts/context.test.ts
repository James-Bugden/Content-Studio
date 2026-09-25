import { describe, it, expect } from 'vitest';
import { buildFactContext } from '@/replies/lib/facts/context';
import type { Fact } from '@/replies/lib/facts/types';

/**
 * Synthetic fixtures only. `source_reference` below is deliberately identifiable
 * ('THIS-MUST-NEVER-LEAVE') so a regression that forwards it cannot hide as an
 * innocuous-looking string.
 */

const NOW = new Date('2026-09-22T09:00:00Z');

function eligibleFact(overrides: Partial<Fact> = {}): Fact {
  return {
    id: 'fact-eligible-0001',
    user_id: 'owner-0000',
    fact_text: 'Shipped a synthetic feature called Widgetline Lite ahead of a fictional deadline.',
    tags: ['shipping'],
    source_reference: { note: 'THIS-MUST-NEVER-LEAVE', imported_from: 'synthetic-fixture' },
    approved: true,
    sensitivity: 'public_safe',
    active: true,
    valid_from: null,
    valid_to: null,
    version: 3,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    ...overrides,
  };
}

describe('buildFactContext (C06)', () => {
  it('contains the exact fact text, id and version for each eligible fact', () => {
    const fact = eligibleFact();
    const context = buildFactContext([fact], { now: NOW });

    expect(context).toEqual([
      { fact_id: fact.id, version: fact.version, fact_text: fact.fact_text },
    ]);
  });

  it('never includes a source_reference key anywhere in the serialised output', () => {
    const fact = eligibleFact();
    const context = buildFactContext([fact], { now: NOW });

    const serialised = JSON.stringify(context);
    expect(serialised).not.toContain('source_reference');
    expect(serialised).not.toContain('THIS-MUST-NEVER-LEAVE');
  });

  it('returns an empty array for an empty input, which is a valid outcome', () => {
    expect(buildFactContext([], { now: NOW })).toEqual([]);
  });

  it('throws rather than silently leaking a planted ineligible fact', () => {
    const unapproved = eligibleFact({ id: 'fact-unapproved', approved: false });
    expect(() => buildFactContext([unapproved], { now: NOW })).toThrow(/ineligible fact/);
  });

  it('throws for a planted private_context_only fact even though every other gate passes', () => {
    const privateOnly = eligibleFact({
      id: 'fact-private',
      sensitivity: 'private_context_only',
    });
    expect(() => buildFactContext([privateOnly], { now: NOW })).toThrow(/ineligible fact/);
  });

  it('throws on the first ineligible fact in a mixed batch rather than returning the eligible ones', () => {
    const good = eligibleFact({ id: 'fact-good' });
    const bad = eligibleFact({ id: 'fact-bad', active: false });
    expect(() => buildFactContext([good, bad], { now: NOW })).toThrow(/fact-bad/);
  });
});

