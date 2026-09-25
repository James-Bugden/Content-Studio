import type { Fact } from './types';

/**
 * C06's central rule: a fact may enter a generated reply only when four
 * independent gates are all true at once. This module is the only place that
 * rule is written down. Nothing here does I/O; a route or a job calls these
 * functions with a fact it already fetched and a clock it already read.
 *
 * A fact ID passing every gate here is not proof that a model's later wording
 * faithfully reflects the fact. That semantic check belongs to issue #14, and
 * lives downstream of this module, never inside it: eligibility answers "may
 * this fact be used at all", not "was it used correctly".
 */

export type EligibilityReason =
  | 'eligible'
  | 'not_approved'
  | 'inactive'
  | 'expired'
  | 'not_yet_valid'
  | 'private_only';

/**
 * `valid_from`/`valid_to` are SQL `date` values with no time zone of their
 * own. Converting both sides of a comparison to UTC calendar days, rather
 * than comparing millisecond timestamps, means the same fact is eligible on
 * the same calendar day no matter what local offset the caller's clock is in.
 */
function dateOnlyToUtcDays(dateOnly: string): number {
  const segments = dateOnly.split('-');
  const year = Number(segments[0]);
  const month = Number(segments[1]);
  const day = Number(segments[2]);
  return Date.UTC(year, month - 1, day);
}

function nowToUtcDays(now: Date): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

/**
 * Returns the first gate a fact fails, so a UI can explain a refusal instead
 * of just showing one. The checks run in the order C06 states the four gates:
 * approved, active, currently valid, then public_safe.
 *
 * Only one of the two validity reasons can ever fire for a given fact, because
 * the database's `facts_validity_ordered` check already refuses a row where
 * `valid_from` is after `valid_to`.
 */
export function eligibilityReason(fact: Fact, now: Date): EligibilityReason {
  if (!fact.approved) return 'not_approved';
  if (!fact.active) return 'inactive';

  const today = nowToUtcDays(now);
  if (fact.valid_from !== null && today < dateOnlyToUtcDays(fact.valid_from)) {
    return 'not_yet_valid';
  }
  // Boundaries are inclusive: a fact whose valid_to is today has not expired
  // until the day after, so this compares strictly greater-than.
  if (fact.valid_to !== null && today > dateOnlyToUtcDays(fact.valid_to)) {
    return 'expired';
  }

  if (fact.sensitivity !== 'public_safe') return 'private_only';

  return 'eligible';
}

/**
 * A thin wrapper over `eligibilityReason` rather than a second implementation
 * of the same rule, so the boolean and the explanation can never quietly
 * drift apart from one another.
 */
export function isEligibleForGeneration(fact: Fact, now: Date): boolean {
  return eligibilityReason(fact, now) === 'eligible';
}

