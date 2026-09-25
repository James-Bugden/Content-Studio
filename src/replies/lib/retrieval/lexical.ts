import { RETRIEVAL } from '@/replies/lib/contracts/limits';
import { searchText } from '@/replies/lib/contracts/text';
import type { EligibilityOptions } from './eligibility';
import type { SqlRunner } from './runner';

/**
 * The two lexical signals, each retrieved independently (C05).
 *
 * They are separate because they fail in opposite directions. English full-text
 * search stems and drops stopwords, which is exactly right for a sentence-length
 * English query and completely useless for Traditional Chinese: a run of Han
 * characters with no spaces becomes a single token, so searching for 面試 never
 * matches 面試準備技巧. Trigram matching has no idea what a word is, which is why
 * it handles Chinese and two-letter keywords, and why on its own it happily
 * ranks a document that shares a few characters with the query.
 *
 * Fusing the two ranks (see `fusion.ts`) is what makes either one safe to use.
 *
 * Neither builder writes SQL. Both call a Postgres function defined in
 * `supabase/migrations/20260922000700_retrieval_candidates.sql`, because PostgREST
 * has no raw-SQL channel and a query assembled here could be verified locally but
 * never run in production. One definition, called from a SQL connection here and
 * through `rpc()` by an ordinary web request, means the query these tests exercise
 * is the query production runs.
 *
 * Every value travels as a bound parameter. Nothing the owner typed is ever
 * concatenated into a statement.
 */

/** Row shape both builders project, so a fused id never needs a second lookup. */
export interface LexicalRow {
  id: string;
  platform: string;
  final_text: string;
  provenance: string;
  publication_evidence: string;
  posted_at: string | null;
  posted_date: string | null;
  date_precision: string;
  recorded_at: string;
  score: number;
}

/**
 * Timestamps are formatted in SQL rather than handed back as driver date objects.
 * A `date` column and a `timestamptz` column arrive as the same JavaScript type
 * otherwise, and turning a date-only value into an instant invents a time of day
 * the owner never supplied (C04).
 */
/**
 * How many query terms reach the trigram comparison.
 *
 * Each term costs another `word_similarity` evaluation per candidate row, so an
 * unbounded query would let a long paste dominate the database. Eight covers a
 * realistic search phrase; the remainder still contributes through the
 * whole-query similarity and through full-text search.
 */
const MAX_TRIGRAM_TERMS = 8;

/**
 * Splits the normalised query into comparison terms.
 *
 * Punctuation and symbols separate; Han runs survive intact because there is no
 * reliable way to segment them here and a wrong segmentation is worse than none
 * (the same reasoning as `searchText`).
 */
export function queryTerms(normalisedQuery: string): string[] {
  return normalisedQuery
    .split(/[\s\p{P}\p{S}]+/u)
    .filter((term) => term.length > 0)
    .slice(0, MAX_TRIGRAM_TERMS);
}

export interface LexicalQueryOptions extends EligibilityOptions {
  /** Raw owner input. Normalised here; the stored exact text is never touched. */
  query: string;
  limit?: number;
}

/**
 * English full-text candidates.
 *
 * `plainto_tsquery` ANDs the query's terms, so this list answers "documents that
 * contain all of these ideas". When the query is pure Chinese, or is entirely
 * stopwords, the query parses to nothing and this list is legitimately empty.
 * That is not a failure: the trigram list carries the search.
 */
export interface LexicalQueryOptions extends EligibilityOptions {
  /** Raw owner input. Normalised here; the stored exact text is never touched. */
  query: string;
  limit?: number;
}

/** Shared argument shaping, so no two callers can disagree about the defaults. */
function candidateArgs(options: LexicalQueryOptions) {
  const provenances =
    options.provenances && options.provenances.length > 0 ? [...options.provenances] : null;
  return {
    ownerId: options.ownerId ?? null,
    platforms: options.platforms && options.platforms.length > 0 ? [...options.platforms] : null,
    provenances,
    // An explicit provenance filter is authoritative, including when it asks for
    // ai_draft. This flag only applies when no filter was given.
    includeAiDrafts: provenances === null && options.includeAiDrafts === true,
    includeUnknownDates: options.includeUnknownDates !== false,
    limit: options.limit ?? RETRIEVAL.lexicalCandidates,
  };
}

/**
 * English full-text candidates.
 *
 * `plainto_tsquery` ANDs the query's terms, so this list answers "documents that
 * contain all of these ideas". When the query is pure Chinese, or is entirely
 * stopwords, the query parses to nothing and this list is legitimately empty.
 * That is not a failure: the trigram and containment list carries the search.
 */
export async function fullTextCandidates(
  runner: SqlRunner,
  options: LexicalQueryOptions,
): Promise<LexicalRow[]> {
  const normalised = searchText(options.query);
  if (normalised === '') return [];
  const args = candidateArgs(options);

  const { rows } = await runner.query<LexicalRow>(
    `select * from public.search_reply_candidates_fulltext($1, $2, $3::uuid, $4::text[], $5::text[], $6, $7)`,
    [
      normalised,
      args.limit,
      args.ownerId,
      args.platforms,
      args.provenances,
      args.includeAiDrafts,
      args.includeUnknownDates,
    ],
  );
  return rows;
}

/**
 * Trigram and containment candidates: the signal that makes Chinese work.
 *
 * Measured against this schema, `word_similarity('面試', '今天分享一個面試準備的技巧')`
 * is exactly 0, because pg_trgm pads a standalone word: the query yields "  面",
 * " 面試", "面試 " while the same characters inside an unspaced Han run yield
 * "個面試", "面試準". They share nothing. Containment is therefore not a nicety, it
 * is the only signal that finds Traditional Chinese or a two-character keyword,
 * which is why C05 names escaped substring matching separately from trigram
 * matching. The scoring itself lives in the database function.
 */
export async function trigramCandidates(
  runner: SqlRunner,
  options: LexicalQueryOptions,
): Promise<LexicalRow[]> {
  const normalised = searchText(options.query);
  if (normalised === '') return [];
  const args = candidateArgs(options);

  const { rows } = await runner.query<LexicalRow>(
    `select * from public.search_reply_candidates_trigram($1, $2::text[], $3, $4, $5::uuid, $6::text[], $7::text[], $8, $9)`,
    [
      normalised,
      queryTerms(normalised),
      args.limit,
      RETRIEVAL.minLexicalScore,
      args.ownerId,
      args.platforms,
      args.provenances,
      args.includeAiDrafts,
      args.includeUnknownDates,
    ],
  );
  return rows;
}

