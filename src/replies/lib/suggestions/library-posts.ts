import { SUGGESTION_LIMITS, type SuggestedPost } from '@/replies/lib/contracts/api';
import { excerpt, overlap, queryTokens, squash } from './text';

/**
 * Earlier Content Studio posts as reference material (#245).
 *
 * The lexical search runs server-side over a bounded candidate set. These pure
 * functions rank and shape that set; they never see, and never return, the whole
 * library.
 */

/** The columns the search reads. Anything else stays in the database. */
export interface LibraryPostRow {
  library_id: string;
  current_hook: string;
  pesto: string;
  draft_content: string;
  content_source: string;
  target_platform: string;
}

/** How many candidate rows the database may hand back for ranking. */
export const POST_CANDIDATE_LIMIT = 60;

/** Per-post text bound when a post is quoted into a rewrite prompt. */
export const POST_CONTEXT_CHARS = 1500;

/** Text columns the candidate query may match. The image ones let one query serve both searches. */
export const POST_SEARCH_COLUMNS = [
  'draft_content',
  'current_hook',
  'pesto',
  'content_source',
  'image_alt_text',
  'image_brief',
] as const;

/** Exactly the columns the candidate query selects, and nothing more. */
export const POST_CANDIDATE_SELECT =
  'library_id, current_hook, pesto, draft_content, content_source, target_platform, image_file, image_file_url, image_alt_text, image_brief';

export function postSearchTokens(query: string): string[] {
  // Database-side filtering only needs a handful of tokens to find candidates.
  return queryTokens(query).slice(0, 8);
}

/**
 * A PostgREST `or` filter for the candidate query. Tokens are reduced to letters
 * and digits first, so a pasted post cannot inject filter syntax (commas, parens,
 * dots) into it.
 */
export function postCandidateFilter(tokens: readonly string[]): string | null {
  const safe = tokens
    .map((token) => token.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((token) => token.length >= 2);
  if (safe.length === 0) return null;
  return safe
    .flatMap((token) => POST_SEARCH_COLUMNS.map((column) => `${column}.ilike.%${token}%`))
    .join(',');
}

export function scorePost(tokens: readonly string[], row: LibraryPostRow): number {
  return (
    overlap(tokens, row.current_hook) * 3 +
    overlap(tokens, row.pesto) * 2 +
    overlap(tokens, row.content_source) +
    overlap(tokens, row.draft_content)
  );
}

export function toSuggestedPost(row: LibraryPostRow): SuggestedPost {
  const title = squash(row.current_hook) || squash(row.draft_content).slice(0, 80) || row.library_id;
  return {
    id: row.library_id,
    title: excerpt(title, 120),
    excerpt: excerpt(row.draft_content, SUGGESTION_LIMITS.excerptChars),
    text: postContextText(row),
    platform: row.target_platform,
  };
}

export function rankLibraryPosts(
  query: string,
  rows: readonly LibraryPostRow[],
  limit: number = SUGGESTION_LIMITS.posts,
): SuggestedPost[] {
  const tokens = queryTokens(query);
  if (tokens.length === 0 || limit <= 0) return [];
  return rows
    .map((row) => ({ row, score: scorePost(tokens, row) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.row.library_id.localeCompare(b.row.library_id))
    .slice(0, Math.min(limit, SUGGESTION_LIMITS.posts))
    .map((entry) => toSuggestedPost(entry.row));
}

/** The bounded text of one post, for quoting into a rewrite as reference material. */
export function postContextText(row: Pick<LibraryPostRow, 'current_hook' | 'draft_content'>): string {
  const hook = squash(row.current_hook);
  const body = row.draft_content.trim();
  return excerptKeepingBreaks(hook ? `${hook}\n\n${body}` : body, POST_CONTEXT_CHARS);
}

function excerptKeepingBreaks(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max ? text : chars.slice(0, max).join('').trimEnd();
}
