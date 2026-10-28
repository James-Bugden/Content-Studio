import { describe, expect, it } from 'vitest';
import {
  MAX_SUGGESTED_TAGS,
  bankImageMetaOutputSchema,
  normaliseSuggestion,
  normaliseTag,
  normaliseTags,
  parseTagInput,
} from '@/replies/lib/images/tags';

describe('tag suggestion normalisation (#245)', () => {
  it('lowercases, strips hashtags and punctuation, and collapses spaces', () => {
    expect(normaliseTag('  #Cover   Letter!! ')).toBe('cover letter');
    expect(normaliseTag('Résumé')).toBe('résumé');
    expect(normaliseTag('履歷')).toBe('履歷');
    expect(normaliseTag('line\nbreak')).toBe('line break');
  });

  it('drops empties and over-long tags', () => {
    expect(normaliseTag('###')).toBeNull();
    expect(normaliseTag('a'.repeat(41))).toBeNull();
    expect(normaliseTag('a'.repeat(40))).toBe('a'.repeat(40));
  });

  it('removes duplicates after normalising and caps the count', () => {
    expect(normaliseTags(['Interview', '#interview', 'INTERVIEW!', 'offer'])).toEqual(['interview', 'offer']);
    const many = Array.from({ length: 30 }, (_, index) => `tag${index}`);
    expect(normaliseTags(many)).toHaveLength(MAX_SUGGESTED_TAGS);
    expect(normaliseTags(many, 20)).toHaveLength(20);
  });

  it('turns model output into editable fields: one line, trimmed, no trailing full stop on the title', () => {
    const suggestion = normaliseSuggestion({
      title: '  Cover letter\nchecklist. ',
      altText: 'A checklist\n for a cover letter.',
      tags: ['Cover Letter', '#checklist', 'cover letter'],
    });
    expect(suggestion).toEqual({
      title: 'Cover letter checklist',
      alt_text: 'A checklist for a cover letter.',
      tags: ['cover letter', 'checklist'],
    });
  });

  it('clips an over-long title and alt text instead of failing', () => {
    const suggestion = normaliseSuggestion({ title: 'word '.repeat(80), altText: 'a'.repeat(400), tags: [] });
    expect([...suggestion.title].length).toBeLessThanOrEqual(100);
    expect([...suggestion.alt_text].length).toBeLessThanOrEqual(250);
  });

  it('parses what a person types into the tags box', () => {
    expect(parseTagInput('Interview, offer\n  negotiation ,, #salary')).toEqual(['interview', 'offer', 'negotiation', 'salary']);
    expect(parseTagInput('')).toEqual([]);
  });

  it('holds the model to a strict shape: extra keys and empty fields fail', () => {
    expect(bankImageMetaOutputSchema.safeParse({ title: 'a', altText: 'b', tags: [] }).success).toBe(true);
    expect(bankImageMetaOutputSchema.safeParse({ title: 'a', altText: 'b', tags: [], approve: true }).success).toBe(false);
    expect(bankImageMetaOutputSchema.safeParse({ title: '', altText: 'b', tags: [] }).success).toBe(false);
    expect(bankImageMetaOutputSchema.safeParse({ title: 'a', altText: 'b', tags: 'x' }).success).toBe(false);
  });
});
