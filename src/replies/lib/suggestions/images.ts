import { SUGGESTION_LIMITS, type SuggestedImage } from '@/replies/lib/contracts/api';
import { overlap, queryTokens, squash } from './text';

/**
 * Previously used images (#245): bank images and images attached to Content
 * Library posts, matched together by tags, alt text and brief. Pure ranking; the
 * stores supply the candidates.
 */

export interface ImageCandidate {
  id: string;
  source: 'bank' | 'post';
  title: string;
  alt_text: string;
  tags: string[];
  /** Free text such as a post's image brief. */
  brief: string;
  url: string;
}

export interface PostImageRow {
  library_id: string;
  current_hook: string;
  image_file: string;
  image_file_url: string;
  image_alt_text: string;
  image_brief: string;
}

/** A post "has an image" only when it points at a file. */
export function postImageCandidate(row: PostImageRow): ImageCandidate | null {
  if (!row.image_file.trim() && !row.image_file_url.trim()) return null;
  return {
    id: row.library_id,
    source: 'post',
    title: squash(row.current_hook) || row.library_id,
    alt_text: squash(row.image_alt_text),
    tags: [],
    brief: briefText(row.image_brief),
    url: `/api/library/${encodeURIComponent(row.library_id)}/asset`,
  };
}

/** The brief is stored as JSON for pipeline posts; only its words are searchable. */
export function briefText(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) return squash(trimmed).slice(0, 600);
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const ideas = Array.isArray(parsed.mainIdeas) ? parsed.mainIdeas : [];
    const words = [parsed.lesson, parsed.focalPhrase, parsed.altText, ...ideas].filter(
      (value): value is string => typeof value === 'string',
    );
    return squash(words.join(' ')).slice(0, 600);
  } catch {
    return '';
  }
}

export function scoreImage(tokens: readonly string[], image: ImageCandidate): number {
  return (
    overlap(tokens, image.tags.join(' ')) * 3 +
    overlap(tokens, image.alt_text) * 2 +
    overlap(tokens, image.title) * 2 +
    overlap(tokens, image.brief)
  );
}

export function rankImages(
  query: string,
  candidates: readonly ImageCandidate[],
  limit: number = SUGGESTION_LIMITS.images,
): SuggestedImage[] {
  const tokens = queryTokens(query);
  if (tokens.length === 0 || limit <= 0) return [];
  return candidates
    .map((image) => ({ image, score: scoreImage(tokens, image) }))
    .filter((entry) => entry.score > 0)
    // A bank image is one the owner chose to keep, so it wins a tie.
    .sort((a, b) => b.score - a.score || (a.image.source === b.image.source ? 0 : a.image.source === 'bank' ? -1 : 1))
    .slice(0, Math.min(limit, SUGGESTION_LIMITS.images))
    .map(({ image }) => ({
      id: image.id,
      source: image.source,
      title: image.title,
      alt_text: image.alt_text,
      tags: image.tags,
      url: image.url,
    }));
}
