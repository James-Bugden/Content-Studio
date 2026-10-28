import { describe, expect, it } from 'vitest';
import { briefText, postImageCandidate, rankImages, type ImageCandidate } from '@/replies/lib/suggestions/images';
import { SUGGESTION_LIMITS, suggestedImageSchema } from '@/replies/lib/contracts/api';

const bank = (overrides: Partial<ImageCandidate> = {}): ImageCandidate => ({
  id: 'bank-1',
  source: 'bank',
  title: 'Checklist',
  alt_text: '',
  tags: [],
  brief: '',
  url: '/api/replies/images/bank-1/file',
  ...overrides,
});

describe('image matching (#245)', () => {
  it('matches bank images and post images together, by tags, alt text and brief', () => {
    const results = rankImages('Is a cover letter still worth writing?', [
      bank({ id: 'tag', tags: ['cover letter'] }),
      bank({ id: 'alt', alt_text: 'A diagram of a cover letter structure' }),
      {
        id: 'LIB-7',
        source: 'post',
        title: 'Some post',
        alt_text: '',
        tags: [],
        brief: 'three steps for a cover letter opening',
        url: '/api/library/LIB-7/asset',
      },
      bank({ id: 'miss', tags: ['salary'] }),
    ]);
    expect(results.map((image) => image.id).sort()).toEqual(['LIB-7', 'alt', 'tag']);
    expect(results.every((image) => suggestedImageSchema.safeParse(image).success)).toBe(true);
  });

  it('weights tags above alt text above the brief', () => {
    const results = rankImages('cover letter', [
      bank({ id: 'brief', brief: 'cover letter' }),
      bank({ id: 'alt', alt_text: 'cover letter' }),
      bank({ id: 'tag', tags: ['cover letter'] }),
    ]);
    expect(results.map((image) => image.id)).toEqual(['tag', 'alt', 'brief']);
  });

  it('prefers the bank on a tie', () => {
    const post: ImageCandidate = { ...bank({ id: 'LIB-1', tags: ['cover letter'] }), source: 'post' };
    const results = rankImages('cover letter', [post, bank({ id: 'b', tags: ['cover letter'] })]);
    expect(results[0]!.source).toBe('bank');
  });

  it('never returns more than the limit and never an unmatched image', () => {
    const many = Array.from({ length: 30 }, (_, index) => bank({ id: `i${index}`, tags: ['cover letter'] }));
    expect(rankImages('cover letter', many, 99)).toHaveLength(SUGGESTION_LIMITS.images);
    expect(rankImages('quantum physics', many)).toEqual([]);
  });

  it('exposes only same-origin URLs, never a path or file reference', () => {
    const [image] = rankImages('cover letter', [bank({ tags: ['cover letter'] })]);
    expect(image!.url.startsWith('/api/')).toBe(true);
    expect(Object.keys(image!).sort()).toEqual(['alt_text', 'id', 'source', 'tags', 'title', 'url']);
  });
});

describe('images attached to Library posts', () => {
  const post = {
    library_id: 'LIB-3',
    current_hook: 'A hook',
    image_file: '',
    image_file_url: '',
    image_alt_text: 'Alt',
    image_brief: '',
  };

  it('counts a post as having an image only when it points at a file', () => {
    expect(postImageCandidate(post)).toBeNull();
    const withFile = postImageCandidate({ ...post, image_file: 'https://drive.google.com/file/d/abc/view' })!;
    expect(withFile.source).toBe('post');
    // The Drive link is never exposed: the thumbnail goes through the asset route.
    expect(withFile.url).toBe('/api/library/LIB-3/asset');
    expect(JSON.stringify(withFile)).not.toContain('drive.google.com');
  });

  it('searches the words of a pipeline brief, not its JSON', () => {
    const brief = JSON.stringify({ lesson: 'Open with the problem', mainIdeas: ['Name it', 'Show proof'], placement: 'feed-portrait' });
    const text = briefText(brief);
    expect(text).toContain('Open with the problem');
    expect(text).toContain('Show proof');
    expect(text).not.toContain('feed-portrait');
    expect(briefText('{not json')).toBe('');
    expect(briefText('plain words')).toBe('plain words');
  });
});
