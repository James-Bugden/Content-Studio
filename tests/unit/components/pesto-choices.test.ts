import { describe, expect, it } from 'vitest';
import { pestoChoices } from '@/components/backlog/pesto-choices';

describe('pestoChoices (CS-055)', () => {
  it('always offers the five PESTO stages in order', () => {
    expect(pestoChoices([])).toEqual(['Personal', 'Expertise', 'Social proof', 'Trending', 'Opinions']);
  });

  it('uses the Sheet\'s own spelling for a stage and keeps other existing values', () => {
    expect(pestoChoices(['Personal stories', 'Opinions', 'Build in public', 'O'])).toEqual(
      ['Personal stories', 'Expertise', 'Social proof', 'Trending', 'Opinions', 'Build in public'],
    );
  });

  it('always includes the current value, so opening the picker never changes it', () => {
    expect(pestoChoices([], 'Something odd')).toContain('Something odd');
  });
});
