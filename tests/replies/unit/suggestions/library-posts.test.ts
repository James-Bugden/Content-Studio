import { describe, expect, it } from 'vitest';
import {
  POST_CONTEXT_CHARS,
  postCandidateFilter,
  postContextText,
  postSearchTokens,
  rankLibraryPosts,
  toSuggestedPost,
  type LibraryPostRow,
} from '@/replies/lib/suggestions/library-posts';
import { SUGGESTION_LIMITS, suggestedPostSchema } from '@/replies/lib/contracts/api';

const row = (overrides: Partial<LibraryPostRow>): LibraryPostRow => ({
  library_id: 'LIB-1',
  current_hook: '',
  pesto: '',
  draft_content: '',
  content_source: '',
  target_platform: 'LinkedIn',
  ...overrides,
});

describe('library post lexical search (#245)', () => {
  it('ranks a hook match above a body-only match and drops non-matches', () => {
    const rows = [
      row({ library_id: 'BODY', draft_content: 'A note that mentions the cover letter once.' }),
      row({ library_id: 'HOOK', current_hook: 'Cover letter openings that work', draft_content: 'Short.' }),
      row({ library_id: 'NONE', draft_content: 'Completely unrelated salary talk.' }),
    ];
    const ranked = rankLibraryPosts('Does a cover letter still matter?', rows);
    expect(ranked.map((post) => post.id)).toEqual(['HOOK', 'BODY']);
  });

  it('matches Chinese text, which has no spaces', () => {
    const ranked = rankLibraryPosts('履歷的第一行怎麼寫', [row({ library_id: 'ZH', draft_content: '履歷的第一行最好直接寫出你解決過的問題。' })]);
    expect(ranked.map((post) => post.id)).toEqual(['ZH']);
  });

  it('is bounded: never more than the suggestion limit, whatever the candidate count', () => {
    const rows = Array.from({ length: 60 }, (_, index) => row({ library_id: `P${index}`, draft_content: 'cover letter advice' }));
    expect(rankLibraryPosts('cover letter', rows, 50)).toHaveLength(SUGGESTION_LIMITS.posts);
  });

  it('returns nothing for a query with no usable words', () => {
    expect(rankLibraryPosts('the and of', [row({ draft_content: 'the and of' })])).toEqual([]);
    expect(rankLibraryPosts('cover letter', [], 4)).toEqual([]);
    expect(rankLibraryPosts('cover letter', [row({ draft_content: 'cover letter' })], 0)).toEqual([]);
  });

  it('shapes a post as a short excerpt plus bounded text, never the raw row', () => {
    const long = 'word '.repeat(2000);
    const shaped = toSuggestedPost(row({ current_hook: 'Hook', draft_content: long }));
    expect(shaped.excerpt.length).toBeLessThanOrEqual(SUGGESTION_LIMITS.excerptChars + 3);
    expect(shaped.text.length).toBeLessThanOrEqual(POST_CONTEXT_CHARS);
    expect(suggestedPostSchema.safeParse(shaped).success).toBe(true);
    expect(Object.keys(shaped).sort()).toEqual(['excerpt', 'id', 'platform', 'text', 'title']);
  });

  it('falls back to the body, then the id, when a post has no hook', () => {
    expect(toSuggestedPost(row({ draft_content: 'Body only here.' })).title).toBe('Body only here.');
    expect(toSuggestedPost(row({ library_id: 'LIB-9' })).title).toBe('LIB-9');
  });

  it('quotes a post for a prompt with its hook, bounded', () => {
    const text = postContextText({ current_hook: 'Hook', draft_content: 'x'.repeat(5000) });
    expect(text.startsWith('Hook\n\n')).toBe(true);
    expect([...text].length).toBeLessThanOrEqual(POST_CONTEXT_CHARS);
  });
});

describe('the candidate query filter', () => {
  it('searches every text column for every token', () => {
    const filter = postCandidateFilter(['cover', 'letter'])!;
    expect(filter).toContain('draft_content.ilike.%cover%');
    expect(filter).toContain('current_hook.ilike.%letter%');
    expect(filter).toContain('image_alt_text.ilike.%cover%');
  });

  it('cannot be steered by punctuation in a pasted post', () => {
    const tokens = postSearchTokens('cover),draft_content.not.is.null,(letter');
    const filter = postCandidateFilter(tokens)!;
    // Only the generated clause separators remain; no token contributed one.
    for (const clause of filter.split(',')) expect(clause).toMatch(/^[a-z_]+\.ilike\.%[\p{L}\p{N}]+%$/u);
  });

  it('gives no filter at all for an empty query, so nothing is fetched', () => {
    expect(postCandidateFilter([])).toBeNull();
    expect(postCandidateFilter(['!!', '.'])).toBeNull();
  });

  it('caps the tokens so a pasted essay is not an unbounded search', () => {
    const essay = Array.from({ length: 200 }, (_, index) => `word${index}`).join(' ');
    expect(postSearchTokens(essay).length).toBeLessThanOrEqual(8);
  });
});
