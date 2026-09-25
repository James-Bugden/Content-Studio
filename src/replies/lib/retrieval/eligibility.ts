import type { Platform, Provenance } from '@/replies/lib/contracts/vocabulary';
import type { SqlFragment } from './runner';

/**
 * C05's eligibility rule, expressed as a WHERE fragment.
 *
 * The reason this is a fragment rather than a post-filter is the whole point of
 * the rule: "Filter withdrawn/private-only material before similarity queries,
 * not after selecting a global top-k". Selecting forty candidates and then
 * discarding the withdrawn ones silently shrinks the result set, and in the worst
 * case returns nothing while relevant eligible writing sat at rank forty-one.
 *
 * `r` is the `reply_library` alias every caller in this package uses.
 */

/** Excluded from default voice evidence, still findable on an explicit filter. */
export const DEFAULT_EXCLUDED_PROVENANCE: Provenance = 'ai_draft';

/**
 * Provenances that count as the owner's own approved writing.
 *
 * All three are text the owner wrote. They are not interchangeable: only
 * `posted_confirmed` may be described as a reply that was actually posted, which
 * is why the row carries its true provenance all the way to the UI rather than
 * being flattened into "past reply" here (D04, D05).
 */
export const VOICE_EVIDENCE_PROVENANCES: readonly Provenance[] = [
  'posted_confirmed',
  'published_main_post',
  'user_edited_unconfirmed',
];

export interface EligibilityOptions {
  /**
   * Explicit owner scoping. Row level security already restricts an ordinary
   * session, but the worker and the import path run with an administrative
   * connection where RLS is not the boundary, so the predicate is written out
   * rather than assumed (C01).
   */
  ownerId?: string;
  platforms?: readonly Platform[];
  /**
   * An explicit provenance filter. When supplied it is authoritative, including
   * when it asks for `ai_draft`: that is the deliberate "show me my drafts too"
   * case C05 allows.
   */
  provenances?: readonly Provenance[];
  /** Only consulted when `provenances` is absent. */
  includeAiDrafts?: boolean;
  /** Replies with no proven date are still the owner's writing. Default true. */
  includeUnknownDates?: boolean;
}

/**
 * Builds the fragment, numbering its placeholders from `firstParamIndex`.
 *
 * Every value travels as a parameter. Nothing the owner typed, and nothing that
 * arrived from an import, is ever concatenated into the statement.
 */
export function eligibilityClause(
  options: EligibilityOptions,
  firstParamIndex: number,
): SqlFragment {
  const conditions: string[] = ['r.withdrawn_at is null'];
  const params: unknown[] = [];
  let index = firstParamIndex;

  if (options.ownerId !== undefined) {
    conditions.push(`r.user_id = $${index}::uuid`, `d.user_id = $${index}::uuid`);
    params.push(options.ownerId);
    index += 1;
  }

  if (options.platforms && options.platforms.length > 0) {
    // Compared as text so the array parameter needs no enum array literal, which
    // is the one place a driver difference could turn into a runtime surprise.
    conditions.push(`r.platform::text = any($${index}::text[])`);
    params.push([...options.platforms]);
    index += 1;
  }

  if (options.provenances && options.provenances.length > 0) {
    conditions.push(`r.provenance::text = any($${index}::text[])`);
    params.push([...options.provenances]);
    index += 1;
  } else if (options.includeAiDrafts !== true) {
    conditions.push(`r.provenance::text <> $${index}`);
    params.push(DEFAULT_EXCLUDED_PROVENANCE);
    index += 1;
  }

  if (options.includeUnknownDates === false) {
    conditions.push(`r.date_precision::text <> 'unknown'`);
  }

  return { sql: conditions.join('\n  and '), params };
}

/** The options a generation context uses: the owner's writing, never a draft. */
export function voiceEvidenceOptions(
  options: Omit<EligibilityOptions, 'provenances' | 'includeAiDrafts'>,
): EligibilityOptions {
  return { ...options, provenances: VOICE_EVIDENCE_PROVENANCES, includeAiDrafts: false };
}

