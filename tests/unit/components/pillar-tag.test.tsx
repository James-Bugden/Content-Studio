// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PillarTag, pillarTone } from '@/components/pillar-tag';

afterEach(cleanup);

describe('PillarTag (THEME-03)', () => {
  it.each([
    ['Personal story', 'personal'],
    ['Story', 'personal'],
    ['P', 'personal'],
    ['Expertise', 'expertise'],
    ['Social proof', 'social'],
    ['Trending', 'trending'],
    ['Opinions', 'opinions'],
    ['Build in public (Soar)', 'build'],
    ['Unexpected Sheet value', 'neutral'],
    ['', 'neutral'],
  ] as const)('maps %j to the deterministic %s tone', (value, tone) => {
    expect(pillarTone(value)).toBe(tone);
  });

  it('keeps the category as visible text and exposes its tone for verification', () => {
    const { container } = render(<PillarTag value="Trending" />);
    expect(screen.getByText('Trending')).toBeTruthy();
    expect(container.firstElementChild?.getAttribute('data-pillar-tone')).toBe('trending');
  });

  it('labels an empty pillar instead of relying on a neutral colour', () => {
    render(<PillarTag value="" />);
    expect(screen.getByText('No pillar')).toBeTruthy();
  });
});
