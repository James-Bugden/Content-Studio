import { z } from 'zod';
import { RETRIEVAL } from '@/replies/lib/contracts/limits';
import { AppError } from '@/replies/lib/contracts/errors';
import { payloadFingerprint, searchText } from '@/replies/lib/contracts/text';
import {
  pastReplySchema,
  type LibrarySearchResponse,
  type PastReply,
} from '@/replies/lib/contracts/api';
import {
  datePrecisionSchema,
  platformSchema,
  provenanceSchema,
  publicationEvidenceSchema,
  type Platform,
  type Provenance,
} from '@/replies/lib/contracts/vocabulary';
import { type LexicalRow } from './lexical';
import { sqlCandidateSource, type CandidateSource } from './candidates';
import { semanticCandidates, vectorSearchAvailable } from './semantic';
import { applyTieBreaks, reciprocalRankFusion, type RankedList } from './fusion';
import { VOICE_EVIDENCE_PROVENANCES } from './eligibility';
import type { SqlRunner } from './runner';

/**
 * The search orchestrator (C05, D04).
 *
 * Three states leave this module and they mean three different things.
 * `ready` is a search that found writing. `empty` is a search that ran correctly
 * and found none. `error` is a search that did not run. Collapsing the last two
 * is the failure D04 warns about: a database outage would render as "you have
 * never written about this", which is a false statement about the owner's own
 * archive, and it would hide a retry the owner would obviously want.
 *
 * Lexical retrieval is the floor. The semantic list joins the fusion only when a
 * query vector is supplied *and* the pgvector column exists; with neither, every
 * path below still returns results.
 */

/**
 * How much of a reply the compact row shows before the expansion control.
 *
 * A display bound, not a storage bound: `full_text` always carries the exact
 * recorded text, because the excerpt is a view of the writing and never a
 * replacement for it (C04, D05).
 */
const EXCERPT_CODE_POINTS = 240;

/**
 * The three states a completed search can be in.
 *
 * `loading` exists in the shared `SectionState` because the client renders it,
 * but a resolved promise is by definition not loading, so it is excluded here
 * rather than left in the type for a caller to have to handle impossibly.
 */
export type SearchState = 'ready' | 'empty' | 'error';

export interface SearchResponse extends Omit<LibrarySearchResponse, 'state'> {
  state: SearchState;
}

export interface SearchOptions {
  query: string;
  /** Explicit owner scoping for administrative connections. */
  ownerId?: string;
  platforms?: readonly Platform[];
  provenances?: readonly Provenance[];
  includeAiDrafts?: boolean;
  includeUnknownDates?: boolean;
  /** Bounded preference between comparably relevant matches, never a filter. */
  preferPlatform?: Platform;
  cursor?: string | null;
  limit?: number;
  /** Supplied by the caller that chose to embed the query. Optional by design. */
  queryVector?: readonly number[];
  embeddingModel?: string;
}

const cursorSchema = z.object({
  v: z.literal(1),
  /** Ties the cursor to the exact query and filters that produced it. */
  f: z.string().min(1),
  /** The sort key of the last row already delivered. */
  id: z.string().min(1),
  s: z.number(),
});
type CursorPayload = z.infer<typeof cursorSchema>;

/**
 * Cursors are opaque and carry a sort key, not an offset.
 *
 * An offset silently skips or repeats rows whenever the underlying set changes,
 * and the set changes every time the owner records a reply. A key identifies a
 * position in a deterministic ordering, so page two continues from where page
 * one stopped even if something was saved in between.
 */
function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): CursorPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new AppError('validation_failed', 'That page link is no longer valid.');
  }
  const result = cursorSchema.safeParse(parsed);
  if (!result.success) {
    throw new AppError('validation_failed', 'That page link is no longer valid.');
  }
  return result.data;
}

interface Ranked {
  id: string;
  score: number;
  provenance: Provenance;
  platform: Platform;
  sortDate: string | null;
  row: LexicalRow;
}

/**
 * Accepts either a SQL connection or a ready-made candidate source.
 *
 * Tests, scripts and the worker hold a Postgres connection and pass it directly.
 * An ordinary web request has only a PostgREST session, so it passes an RPC-backed
 * source instead. Both end up calling the same two database functions.
 */
export type RetrievalBackend = SqlRunner | CandidateSource;

function asCandidateSource(backend: RetrievalBackend): CandidateSource {
  return 'query' in backend ? sqlCandidateSource(backend) : backend;
}

export async function searchReplies(
  backend: RetrievalBackend,
  options: SearchOptions,
): Promise<SearchResponse> {
  const normalised = searchText(options.query);
  const limit = Math.max(1, options.limit ?? RETRIEVAL.initialResults);

  // A blank query is a question with no content, not a broken lookup.
  if (normalised === '') {
    return { state: 'empty', items: [], next_cursor: null };
  }

  const cursor = options.cursor ? decodeCursor(options.cursor) : null;
  const fingerprint = queryFingerprint(options, normalised);
  if (cursor && cursor.f !== fingerprint) {
    // Paging with a cursor from a different query would interleave two result
    // sets. Saying so is better than returning a plausible-looking mixture.
    throw new AppError('validation_failed', 'That page link belongs to a different search.');
  }

  let lists: RankedList[];
  let rows: Map<string, LexicalRow>;
  try {
    const candidates = await gatherCandidates(backend, options);
    lists = candidates.lists;
    rows = candidates.rows;
  } catch {
    // The message is deliberately generic: a database error can name another
    // record's existence, and C07 forbids forwarding it (SEC-05).
    return { state: 'error', items: [], next_cursor: null };
  }

  const fused = reciprocalRankFusion(lists);
  const ranked: Ranked[] = [];
  for (const item of fused) {
    const row = rows.get(item.id);
    if (!row) continue;
    ranked.push({
      id: item.id,
      score: item.score,
      provenance: provenanceSchema.parse(row.provenance),
      platform: platformSchema.parse(row.platform),
      sortDate: row.posted_at ?? row.posted_date,
      row,
    });
  }

  const ordered = applyTieBreaks(ranked, {
    ...(options.preferPlatform ? { preferPlatform: options.preferPlatform } : {}),
  });

  if (ordered.length === 0) {
    return { state: 'empty', items: [], next_cursor: null };
  }

  const start = cursorStart(ordered, cursor);
  const page = ordered.slice(start, start + limit);
  const last = page.at(-1);
  const hasMore = start + page.length < ordered.length;

  return {
    state: page.length === 0 ? 'empty' : 'ready',
    items: page.map((item) => toPastReply(item.row)),
    next_cursor:
      hasMore && last ? encodeCursor({ v: 1, f: fingerprint, id: last.id, s: last.score }) : null,
  };
}

/**
 * At most `RETRIEVAL.maxContextSnippets` pieces of the owner's own writing for a
 * generation request (C05).
 *
 * AI drafts are excluded and cannot be re-enabled here. A model's earlier output
 * is not evidence of how the owner writes, and feeding it back would make the
 * voice drift towards the model with every run.
 *
 * A retrieval failure returns no snippets rather than throwing: generation runs
 * with less context, and an outage in one section never takes out another (D04).
 */
export async function contextSnippets(
  backend: RetrievalBackend,
  options: Omit<SearchOptions, 'provenances' | 'includeAiDrafts' | 'cursor'>,
): Promise<PastReply[]> {
  const limit = Math.min(options.limit ?? RETRIEVAL.maxContextSnippets, RETRIEVAL.maxContextSnippets);
  const response = await searchReplies(backend, {
    ...options,
    provenances: VOICE_EVIDENCE_PROVENANCES,
    includeAiDrafts: false,
    cursor: null,
    limit,
  });
  if (response.state !== 'ready') return [];
  return response.items.filter((item) => item.provenance !== 'ai_draft').slice(0, limit);
}

async function gatherCandidates(
  backend: RetrievalBackend,
  options: SearchOptions,
): Promise<{ lists: RankedList[]; rows: Map<string, LexicalRow> }> {
  const source = asCandidateSource(backend);
  const [fullText, trigram] = await Promise.all([
    source.fullText(options),
    source.trigram(options),
  ]);

  const lists: RankedList[] = [
    { signal: 'fulltext', ids: fullText.map((r) => r.id) },
    { signal: 'trigram', ids: trigram.map((r) => r.id) },
  ];
  const rows = new Map<string, LexicalRow>();
  for (const row of [...fullText, ...trigram]) rows.set(row.id, row);

  // The vector path needs a SQL connection: pgvector's operators have no PostgREST
  // equivalent. An ordinary request therefore ranks lexically only, which is the
  // floor the whole design is built on rather than a degraded mode (C05, D-04).
  if (
    'query' in backend &&
    options.queryVector &&
    options.embeddingModel &&
    (await vectorSearchAvailable(backend))
  ) {
    const semantic = await semanticCandidates(backend, {
      ...options,
      vector: options.queryVector,
      model: options.embeddingModel,
    });
    lists.push({ signal: 'semantic', ids: semantic.map((r) => r.id) });
    for (const row of semantic) if (!rows.has(row.id)) rows.set(row.id, row);
  }

  return { lists, rows };
}

/**
 * Where the next page starts.
 *
 * The id lookup is the normal path. The score fallback covers the case where the
 * row the cursor names has since been withdrawn or corrected out of the result
 * set: rather than restarting at the top and repeating rows the owner has already
 * seen, continue from the first row that ranks below the remembered key.
 */
function cursorStart(ordered: readonly Ranked[], cursor: CursorPayload | null): number {
  if (!cursor) return 0;
  const index = ordered.findIndex((item) => item.id === cursor.id);
  if (index >= 0) return index + 1;
  const fallback = ordered.findIndex((item) => item.score < cursor.s);
  return fallback >= 0 ? fallback : ordered.length;
}

function queryFingerprint(options: SearchOptions, normalised: string): string {
  return payloadFingerprint({
    q: normalised,
    o: options.ownerId ?? null,
    p: options.platforms ? [...options.platforms].sort() : null,
    v: options.provenances ? [...options.provenances].sort() : null,
    a: options.includeAiDrafts === true,
    u: options.includeUnknownDates !== false,
    f: options.preferPlatform ?? null,
    m: options.queryVector ? (options.embeddingModel ?? null) : null,
  });
}

function toPastReply(row: LexicalRow): PastReply {
  return pastReplySchema.parse({
    id: row.id,
    platform: platformSchema.parse(row.platform),
    excerpt: excerptOf(row.final_text),
    full_text: row.final_text,
    provenance: provenanceSchema.parse(row.provenance),
    publication_evidence: publicationEvidenceSchema.parse(row.publication_evidence),
    posted_at: row.posted_at,
    posted_date: row.posted_date,
    date_precision: datePrecisionSchema.parse(row.date_precision),
  });
}

/** Cuts on code points so an emoji or a Han character is never split in half. */
function excerptOf(text: string): string {
  const points = [...text];
  if (points.length <= EXCERPT_CODE_POINTS) return text;
  return `${points.slice(0, EXCERPT_CODE_POINTS).join('')}…`;
}

