import { describe, it, expect } from 'vitest';
import { eligibilityReason, isEligibleForGeneration } from '@/replies/lib/facts/eligibility';
import type { Fact } from '@/replies/lib/facts/types';

/**
 * C06's four gates, tested as a table so the boolean and the reason are
 * checked together for every case: a reason function nobody checked against
 * the boolean it should agree with is just a second, unverified opinion.
 *
 * All fixtures are synthetic. "Acme Robotics" and "Example University" are
 * placeholders, not real employers, and this is a public repository.
 */

const NOW = new Date('2026-09-22T09:00:00Z');

function baseFact(overrides: Partial<Fact> = {}): Fact {
  return {
    id: 'fact-0000',
    user_id: 'owner-0000',
    fact_text: 'Led a synthetic five-person team migrating Acme Robotics off a legacy queue.',
    tags: ['leadership', 'migration'],
    source_reference: { note: 'synthetic fixture, not a real source' },
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

describe('eligibilityReason and isEligibleForGeneration (C06)', () => {
  it('is eligible when approved, public_safe, active and currently valid', () => {
    const fact = baseFact();
    expect(eligibilityReason(fact, NOW)).toBe('eligible');
    expect(isEligibleForGeneration(fact, NOW)).toBe(true);
  });

  it('refuses an unapproved fact', () => {
    const fact = baseFact({ approved: false });
    expect(eligibilityReason(fact, NOW)).toBe('not_approved');
    expect(isEligibleForGeneration(fact, NOW)).toBe(false);
  });

  it('refuses an inactive fact', () => {
    const fact = baseFact({ active: false });
    expect(eligibilityReason(fact, NOW)).toBe('inactive');
    expect(isEligibleForGeneration(fact, NOW)).toBe(false);
  });

  it('refuses a fact whose valid_to was yesterday', () => {
    const fact = baseFact({ valid_to: '2026-09-21' });
    expect(eligibilityReason(fact, NOW)).toBe('expired');
    expect(isEligibleForGeneration(fact, NOW)).toBe(false);
  });

  it('refuses a fact whose valid_from is tomorrow', () => {
    const fact = baseFact({ valid_from: '2026-09-23' });
    expect(eligibilityReason(fact, NOW)).toBe('not_yet_valid');
    expect(isEligibleForGeneration(fact, NOW)).toBe(false);
  });

  it('refuses a private_context_only fact even when everything else is perfect', () => {
    const fact = baseFact({ sensitivity: 'private_context_only' });
    expect(eligibilityReason(fact, NOW)).toBe('private_only');
    expect(isEligibleForGeneration(fact, NOW)).toBe(false);
  });

  describe('boundary dates are inclusive', () => {
    it('is still eligible when valid_to is exactly today', () => {
      const fact = baseFact({ valid_to: '2026-09-22' });
      expect(eligibilityReason(fact, NOW)).toBe('eligible');
      expect(isEligibleForGeneration(fact, NOW)).toBe(true);
    });

    it('is already eligible when valid_from is exactly today', () => {
      const fact = baseFact({ valid_from: '2026-09-22' });
      expect(eligibilityReason(fact, NOW)).toBe('eligible');
      expect(isEligibleForGeneration(fact, NOW)).toBe(true);
    });

    it('is eligible one day before valid_to expires', () => {
      const fact = baseFact({ valid_to: '2026-09-23' });
      expect(isEligibleForGeneration(fact, NOW)).toBe(true);
    });

    it('is not yet valid one day before valid_from opens', () => {
      const fact = baseFact({ valid_from: '2026-09-22', valid_to: null });
      const dayBefore = new Date('2026-09-21T23:59:00Z');
      expect(eligibilityReason(fact, dayBefore)).toBe('not_yet_valid');
    });
  });

  it('reports the first failing gate in gate order when several fail at once', () => {
    const fact = baseFact({
      approved: false,
      active: false,
      sensitivity: 'private_context_only',
      valid_to: '2026-09-21',
    });
    expect(eligibilityReason(fact, NOW)).toBe('not_approved');
  });
});

