import { EMBEDDING, RETRIEVAL } from '@/replies/lib/contracts/limits';
import { eligibilityClause, type EligibilityOptions } from './eligibility';
import type { LexicalRow } from './lexical';
import type { SqlRunner } from './runner';

/**
 * The optional semantic signal.
 *
 * It is optional in the strict sense: pgvector lives in its own migration, the
 * local verification harness runs on a Postgres build without it, and every
 * retrieval path must return useful results with no embeddings present. Vectors
 * improve ranking. They are never the reason a search works.
 *
 * NOTE FOR REVIEWERS: nothing in this file is exercised by the local test suite,
 * because the column it reads does not exist there. Treat it as unverified until
 * it has been run against the hosted project.
 */

/**
 * Whether the pgvector column exists in this database.
 *
 * Asked of the catalogue rather than inferred from configuration, because a
 * deployment can have an embedding provider configured and the migration not yet
 * applied, and guessing in that direction produces a query that errors on every
 * search.
 */
export async function vectorSearchAvailable(runner: SqlRunner): Promise<boolean> {
  const { rows } = await runner.query<{ present: boolean }>(
    `select exists (
       select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = 'search_documents'
         and column_name = 'embedding'
     ) as present`,
  );
  return rows[0]?.present === true;
}

export interface SemanticQueryOptions extends EligibilityOptions {
  /** The query embedding, produced by the same model the rows were indexed with. */
  vector: readonly number[];
  /** Pinned so two models' vectors are never compared with each other (C03). */
  model: string;
  limit?: number;
}

/**
 * Nearest neighbours by cosine distance, restricted to one embedding model.
 *
 * The model predicate is not an optimisation. Vectors from different models
 * occupy different spaces, so a distance between them is a number with no
 * meaning, and returning it as a ranking would be worse than returning nothing.
 */
export async function semanticCandidates(
  runner: SqlRunner,
  options: SemanticQueryOptions,
): Promise<LexicalRow[]> {
  if (options.vector.length !== EMBEDDING.dimensions) {
    throw new RangeError(
      `a query vector must have ${EMBEDDING.dimensions} dimensions to match the index`,
    );
  }

  const limit = options.limit ?? RETRIEVAL.semanticCandidates;
  const eligibility = eligibilityClause(options, 4);
  const literal = `[${options.vector.join(',')}]`;

  const sql = `
select
  r.id::text as id,
  r.platform::text as platform,
  r.final_text as final_text,
  r.provenance::text as provenance,
  r.publication_evidence::text as publication_evidence,
  to_char(r.posted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as posted_at,
  to_char(r.posted_date, 'YYYY-MM-DD') as posted_date,
  r.date_precision::text as date_precision,
  to_char(r.recorded_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as recorded_at,
  (1 - (d.embedding <=> $1::extensions.vector))::float8 as score
from public.search_documents d
join public.reply_library r
  on r.id = d.entity_id
 and r.user_id = d.user_id
where d.entity_kind = 'reply'
  and d.embedding is not null
  and d.embedding_model = $2
  and ${eligibility.sql}
order by d.embedding <=> $1::extensions.vector
limit $3`;

  const { rows } = await runner.query<LexicalRow>(sql, [
    literal,
    options.model,
    limit,
    ...eligibility.params,
  ]);
  return rows;
}

