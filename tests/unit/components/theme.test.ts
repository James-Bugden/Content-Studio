import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('visual theme (THEME-01)', () => {
  it('uses black as the general UI accent and removes the former blue primary', () => {
    const css = readFileSync('src/app/globals.css', 'utf8');
    expect(css).toContain('--color-primary: #000000;');
    expect(css).not.toContain('#1d4ed8');
    expect(css).toContain('--color-paper: #f6f6f6;');
    expect(css).toContain('--color-card: #ffffff;');
  });
});
