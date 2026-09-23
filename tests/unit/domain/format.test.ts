import { describe, expect, it } from 'vitest';
import { cleanMarkdown, findMarkdown, isBold, platformLength, toBold, toggleBold, toggleBullets, toggleItalic, toggleNumbers, toPlain } from '@/domain/format';

describe('Unicode styling for platforms that do not render Markdown', () => {
  it('bold round-trips and leaves Chinese, emoji and punctuation alone', () => {
    const s = 'Ask for the band 2026, 談薪水 🙂!';
    const b = toBold(s);
    expect(b).not.toBe(s);
    expect(b).toContain('談薪水 🙂!');
    expect(toPlain(b)).toBe(s);
    expect(isBold(b)).toBe(true);
    expect(toggleBold(b)).toBe(s);
  });

  it('italic toggles and converts bold to italic rather than stacking', () => {
    const i = toggleItalic(toBold('scope'));
    expect(toPlain(i)).toBe('scope');
    expect(toggleItalic(i)).toBe('scope');
  });

  it('counts styled letters and emoji as one character each', () => {
    expect(platformLength(toBold('abc'))).toBe(3);
    expect(platformLength('🙂🙂')).toBe(2);
  });
});

describe('lists', () => {
  it('toggles bullets on non-empty lines and back', () => {
    const block = 'their budget\n\nyour market value';
    const on = toggleBullets(block);
    expect(on).toBe('• their budget\n\n• your market value');
    expect(toggleBullets(on)).toBe(block);
  });

  it('numbers lines, replacing Markdown dashes', () => {
    expect(toggleNumbers('- one\n- two')).toBe('1. one\n2. two');
    expect(toggleNumbers('1. one\n2. two')).toBe('one\ntwo');
  });
});

describe('Markdown clean-up', () => {
  it('finds Markdown the platforms would show as symbols', () => {
    const kinds = findMarkdown('# Title\n**bold** and [link](https://example.com)\n- item\n`code`').map((f) => f.kind);
    expect(kinds).toEqual(expect.arrayContaining(['bold', 'heading', 'list', 'link', 'code']));
    expect(findMarkdown('Plain text with a • bullet and 3 * 4 = 12.')).toEqual([]);
  });

  it('converts to platform-ready text without touching Chinese', () => {
    const out = cleanMarkdown('# Negotiate scope\n**Always** ask *why*.\n- their budget\n- 你的市場價值\nSee [guide](https://example.com)');
    expect(out).toBe(`${toBold('Negotiate scope')}\n${toBold('Always')} ask ${toggleItalic('why')}.\n• their budget\n• 你的市場價值\nSee guide (https://example.com)`);
    expect(findMarkdown(out)).toEqual([]);
  });

  it('leaves text without Markdown byte-identical', () => {
    const s = '談薪水不是吵架 🙂\n\n  – their budget\n\nEnd.  ';
    expect(cleanMarkdown(s)).toBe(s);
  });
});
