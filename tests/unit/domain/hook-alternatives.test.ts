import { describe, expect, it } from 'vitest';
import { parseHookAlternatives } from '@/domain/hook-alternatives';

describe('parseHookAlternatives (CS-054)', () => {
  it('splits a numbered list into score, template and hook', () => {
    const raw = [
      '1) 8/10 | Opinion #65, The problem with [thing] (adapted): Working hard on a product the company no longer wants is a hard place to build a career.',
      '2) 8.5/10 | Trending #3, Reddit screenshots (adapted to supplied image): Two comments here tell you to work on a product that makes money.',
      '3) 7.5/10 | Expertise #27, The best advice I can give (adapted): Before accepting a job, find out why.',
    ].join('\n');
    expect(parseHookAlternatives(raw)).toEqual([
      { score: '8/10', template: 'Opinion #65, The problem with [thing] (adapted)', hook: 'Working hard on a product the company no longer wants is a hard place to build a career.' },
      { score: '8.5/10', template: 'Trending #3, Reddit screenshots (adapted to supplied image)', hook: 'Two comments here tell you to work on a product that makes money.' },
      { score: '7.5/10', template: 'Expertise #27, The best advice I can give (adapted)', hook: 'Before accepting a job, find out why.' },
    ]);
  });

  it('joins an item that wraps onto several lines', () => {
    expect(parseHookAlternatives('1) 8/10 | Opinion #1: First line\ncontinues here\n2) 6/10 | X: Second')).toEqual([
      { score: '8/10', template: 'Opinion #1', hook: 'First line continues here' },
      { score: '6/10', template: 'X', hook: 'Second' },
    ]);
  });

  it('keeps unstructured text whole, so nothing is dropped', () => {
    expect(parseHookAlternatives('Try leading with the number: 40% of offers')).toEqual([
      { score: null, template: null, hook: 'Try leading with the number: 40% of offers' },
    ]);
    expect(parseHookAlternatives('  ')).toEqual([]);
  });

  it('a numbered item without a score keeps its colon text in the hook', () => {
    expect(parseHookAlternatives('1) Note: keep it short\n2) Another')).toEqual([
      { score: null, template: null, hook: 'Note: keep it short' },
      { score: null, template: null, hook: 'Another' },
    ]);
  });
});
