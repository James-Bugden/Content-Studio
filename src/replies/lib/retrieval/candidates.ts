import { RETRIEVAL } from '@/replies/lib/contracts/limits';
import { searchText } from '@/replies/lib/contracts/text';
import {
  fullTextCandidates,
  trigramCandidates,
  queryTerms,
  type LexicalRow,
  type LexicalQueryOptions,
} from './lexical';
import type { SqlRunner } from './runner';

/**
 * Where candidate rows come from.
 *
 * The queries themselves live in `supabase/migrations/20260922000700_retrieval_candidates.sql`
 * as two Postgres functions, for a reason worth repeating here: PostgREST has no
 * raw-SQL channel, so SQL assembled in TypeScript can be verified locally and can
 * never run in production. Both implementations below call the *same* two database
 * functions, one through a SQL connection and one through `rpc()`.
 *
 * That makes the verification harness meaningful. The query the tests exercise is
 * the query production runs, rather than a lookalike.
 */

export interface CandidateSource {
  fullText(options: LexicalQueryOptions): Promise<LexicalRow[]>;
  trigram(options: LexicalQueryOptions): Promise<LexicalRow[]>;
}

/** Shared argument shaping, so the two callers cannot drift in what they pass. */
function commonArgs(options: LexicalQueryOptions) {
  const provenances =
    options.provenances && options.provenances.length > 0 ? [...options.provenances] : null;
  return {
    ownerId: options.ownerId ?? null,
    platforms: options.platforms && options.platforms.length > 0 ? [...options.platforms] : null,
    provenances,
    includeAiDrafts: provenances === null && options.includeAiDrafts === true,
    includeUnknownDates: options.includeUnknownDates !== false,
    limit: options.limit ?? RETRIEVAL.lexicalCandidates,
  };
}

/** For a Postgres connection: the verification harness, the worker, scripts. */
export function sqlCandidateSource(runner: SqlRunner): CandidateSource {
  return {
    fullText: (options) => fullTextCandidates(runner, options),
    trigram: (options) => trigramCandidates(runner, options),
  };
}

/** The shape of the one supabase-js method this needs, so no client type leaks in. */
export interface RpcCaller {
  rpc(name: string, params: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
}

/** For an ordinary request: the owner's own PostgREST session, under RLS. */
export function rpcCandidateSource(client: RpcCaller): CandidateSource {
  async function call(name: string, params: Record<string, unknown>): Promise<LexicalRow[]> {
    const { data, error } = await client.rpc(name, params);
    if (error) {
      // A failed lookup must reach the caller as a failure. Returning an empty
      // list here would make "the search broke" indistinguishable from "you have
      // not written about this", which is the distinction C05 insists on.
      throw new Error('retrieval candidate query failed');
    }
    return (data ?? []) as LexicalRow[];
  }

  return {
    async fullText(options) {
      const normalised = searchText(options.query);
      if (normalised === '') return [];
      const args = commonArgs(options);
      return call('search_reply_candidates_fulltext', {
        p_query: normalised,
        p_limit: args.limit,
        p_owner_id: args.ownerId,
        p_platforms: args.platforms,
        p_provenances: args.provenances,
        p_include_ai_drafts: args.includeAiDrafts,
        p_include_unknown_dates: args.includeUnknownDates,
      });
    },

    async trigram(options) {
      const normalised = searchText(options.query);
      if (normalised === '') return [];
      const args = commonArgs(options);
      return call('search_reply_candidates_trigram', {
        p_query: normalised,
        p_terms: queryTerms(normalised),
        p_limit: args.limit,
        p_min_score: RETRIEVAL.minLexicalScore,
        p_owner_id: args.ownerId,
        p_platforms: args.platforms,
        p_provenances: args.provenances,
        p_include_ai_drafts: args.includeAiDrafts,
        p_include_unknown_dates: args.includeUnknownDates,
      });
    },
  };
}

