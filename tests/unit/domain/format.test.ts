import { describe, expect, it } from 'vitest';
import { cleanMarkdown, fewerLineBreaks, findMarkdown, isBold, platformLength, toBold, toggleBold, toggleBullets, toggleItalic, toggleNumbers, toPlain } from '@/domain/format';

describe('fewer line breaks', () => {
  const samples = [
    'Keep this hook.\n\nFirst point.\n\nSecond point.\n\nThird point.\n\nFourth point.',
    'Hook\n\nNo punctuation\n\nAnother thought\n\nOne more thought\n\nLast thought',
    '先保留開場。\n\n第一個想法。\n\n第二個想法。\n\n第三個想法。\n\n最後一個想法。',
    'Hook\r\n\r\n\r\nA hard\r\nwrapped sentence.\r\n\r\n• item one\r\n• item two\r\n\r\nLast.',
    `Hook.\n\n${'Long paragraph. '.repeat(20)}\n\nShort.\n\nNext.`,
  ];
  it.each(samples)('is idempotent and never changes or reorders words: %s', text => {
    const compact = fewerLineBreaks(text);
    expect(fewerLineBreaks(compact)).toBe(compact);
    expect(compact.split(/\s+/)).toEqual(text.split(/\s+/));
  });
  it('keeps the hook separate and merges up to three body sentences', () => {
    expect(fewerLineBreaks(samples[0]!)).toBe('Keep this hook.\n\nFirst point. Second point. Third point.\n\nFourth point.');
  });
  it('collapses excessive spacing and joins hard wraps without merging any list items', () => {
    const lists = '• one\n• two\n\n- three\n- four\n\n1. five\n2. six';
    expect(fewerLineBreaks(`Hook\n\n\n\nHard\nwrap.\n\n${lists}`)).toBe(`Hook\n\nHard wrap.\n\n${lists}`);
  });
});

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
