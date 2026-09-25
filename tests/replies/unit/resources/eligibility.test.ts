import { describe, it, expect } from 'vitest';
import { isInsertable } from '@/replies/lib/resources/eligibility';
import type { ResourceRow } from '@/replies/lib/resources/types';

/**
 * RES-01/RES-02. All three gates are independent: each must be able to exclude
 * a resource on its own, and only a resource clearing all three is eligible.
 */

type EligibilityFixture = Pick<ResourceRow, 'active' | 'verified' | 'allowed_platforms'>;

function resource(overrides: Partial<EligibilityFixture> = {}): EligibilityFixture {
  return {
    active: true,
    verified: true,
    allowed_platforms: ['linkedin', 'x', 'threads'],
    ...overrides,
  };
}

describe('isInsertable', () => {
  it('excludes an inactive resource', () => {
    expect(isInsertable(resource({ active: false }), 'linkedin')).toBe(false);
  });

  it('excludes an unverified resource', () => {
    expect(isInsertable(resource({ verified: false }), 'linkedin')).toBe(false);
  });

  it('excludes a resource not allowed on the requested platform', () => {
    expect(isInsertable(resource({ allowed_platforms: ['x'] }), 'linkedin')).toBe(false);
  });

  it('excludes a resource failing every gate at once', () => {
    expect(
      isInsertable(resource({ active: false, verified: false, allowed_platforms: ['x'] }), 'linkedin'),
    ).toBe(false);
  });

  it('includes a resource that is active, verified and allowed on the platform', () => {
    expect(isInsertable(resource(), 'threads')).toBe(true);
  });
});

