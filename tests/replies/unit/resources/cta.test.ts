import { describe, it, expect } from 'vitest';
import { buildCta } from '@/replies/lib/resources/cta';
import type { ResourceRow } from '@/replies/lib/resources/types';

/**
 * D06. An approved CTA is verbatim owner wording; a generated one names only
 * the real title and never fabricates a free/no-signup/chapter/outcome claim.
 */

type CtaFixture = Pick<ResourceRow, 'cta_en' | 'cta_zh_tw' | 'title_en' | 'title_zh_tw' | 'access_notes'>;

function resource(overrides: Partial<CtaFixture> = {}): CtaFixture {
  return {
    cta_en: null,
    cta_zh_tw: null,
    title_en: 'The Interview Prep Guide',
    title_zh_tw: null,
    access_notes: null,
    ...overrides,
  };
}

const FORBIDDEN_WORDS = ['free', 'no signup', 'chapter'];

describe('buildCta: approved CTA', () => {
  it('uses the English approved CTA verbatim', () => {
    const cta = buildCta(resource({ cta_en: 'Grab the free chapter, no signup needed' }), 'en', 'https://example.com/guide');
    expect(cta).toBe('Grab the free chapter, no signup needed');
  });

  it('uses the zh-TW approved CTA verbatim', () => {
    const cta = buildCta(resource({ cta_zh_tw: '看看這份指南' }), 'zh-TW', 'https://example.com/guide');
    expect(cta).toBe('看看這份指南');
  });

  it('never falls back to the English approved CTA for a zh-TW request', () => {
    const cta = buildCta(
      resource({ cta_en: 'English approved text', cta_zh_tw: null, title_en: 'The Guide' }),
      'zh-TW',
      'https://example.com/guide',
    );
    expect(cta).not.toBe('English approved text');
  });
});

describe('buildCta: generated CTA', () => {
  it('contains the real title', () => {
    const cta = buildCta(resource({ title_en: 'The Interview Prep Guide' }), 'en', 'https://example.com/guide');
    expect(cta).toContain('The Interview Prep Guide');
  });

  it('prefers the verified zh-TW title when generating in zh-TW', () => {
    const cta = buildCta(
      resource({ title_en: 'The Interview Prep Guide', title_zh_tw: '面試準備指南' }),
      'zh-TW',
      'https://example.com/guide',
    );
    expect(cta).toContain('面試準備指南');
  });

  it('contains none of the forbidden claims when access_notes is empty', () => {
    const cta = buildCta(resource({ title_en: 'The Interview Prep Guide' }), 'en', 'https://example.com/guide');
    const lower = cta.toLowerCase();
    for (const word of FORBIDDEN_WORDS) {
      expect(lower).not.toContain(word);
    }
  });

  it('may only include a forbidden word when it is verbatim in access_notes', () => {
    const cta = buildCta(
      resource({ title_en: 'The Interview Prep Guide', access_notes: 'first chapter free, no signup' }),
      'en',
      'https://example.com/guide',
    );
    expect(cta).toContain('first chapter free, no signup');
  });

  it('produces a different phrasing when there is no resolved URL to open', () => {
    const withUrl = buildCta(resource(), 'en', 'https://example.com/guide');
    const withoutUrl = buildCta(resource(), 'en', null);
    expect(withUrl).not.toBe(withoutUrl);
  });
});

