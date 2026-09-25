import { describe, it, expect } from 'vitest';
import { toPlatformText } from '@/replies/lib/text/platform-text';

/**
 * Model output becomes text a social platform will show as written.
 *
 * LinkedIn, Threads and X do not render markdown. A model told to write "plain
 * text" still reaches for **bold** and "* " bullets often enough to matter, and
 * nothing downstream caught it, so the asterisks went into the editor, onto the
 * clipboard and into a live post.
 *
 * This runs on what a model wrote, before the owner sees it. It never touches
 * text the owner typed: that is saved byte for byte (SAVE-01).
 */

describe('emphasis', () => {
  it.each([
    ['**bold** word', 'bold word'],
    ['__bold__ word', 'bold word'],
    ['an *italic* word', 'an italic word'],
    ['***both*** here', 'both here'],
    ['~~struck~~ out', 'struck out'],
    ['use `code` here', 'use code here'],
  ])('%s', (input, expected) => {
    expect(toPlatformText(input)).toBe(expected);
  });

  it('works on Traditional Chinese, which has no spaces to anchor on', () => {
    expect(toPlatformText('**重點**是具體說出你解決了什麼')).toBe('重點是具體說出你解決了什麼');
    expect(toPlatformText('這是*強調*的部分')).toBe('這是強調的部分');
  });
});

describe('structure', () => {
  it('drops heading markers but keeps the words', () => {
    expect(toPlatformText('## Three things\nFirst point')).toBe('Three things\nFirst point');
  });

  it('turns every markdown bullet into a real bullet, matching the formatting toolbar', () => {
    expect(toPlatformText('* one\n+ two\n- three')).toBe('• one\n• two\n• three');
  });

  it('keeps a bullet whose text is emphasised', () => {
    expect(toPlatformText('* **Numbers** first')).toBe('• Numbers first');
  });

  it('keeps numbered lists, which read fine as written', () => {
    expect(toPlatformText('1. Ask\n2. Listen')).toBe('1. Ask\n2. Listen');
  });

  it('removes quote markers, rules and code fences', () => {
    expect(toPlatformText('> quoted\n---\n```\nplain\n```')).toBe('quoted\n\nplain');
  });

  it('keeps link text and drops the address, because links are the application’s job', () => {
    expect(toPlatformText('see [the guide](https://example.com/g) first')).toBe('see the guide first');
    expect(toPlatformText('![chart](https://example.com/c.png) after')).toBe('after');
  });
});

describe('what must survive untouched', () => {
  it.each([
    ['arithmetic', '5 * 3 is 15'],
    ['a lone footnote asterisk', '*Terms apply to new roles only'],
    ['snake_case and handles', 'ping @some_user_name about snake_case_names'],
    ['a bare hyphen dash', 'Short answer - yes'],
    ['emoji and CJK', '好消息 🎉 我們錄取了'],
  ])('%s', (_label, text) => {
    expect(toPlatformText(text)).toBe(text);
  });

  it('keeps paragraph breaks, which are the one formatting every platform shows', () => {
    expect(toPlatformText('First paragraph.\n\nSecond paragraph.')).toBe('First paragraph.\n\nSecond paragraph.');
  });
});

describe('whitespace', () => {
  it('collapses runs of blank lines to one, trims line ends and the whole text', () => {
    expect(toPlatformText('  One.   \n\n\n\nTwo.  \n')).toBe('One.\n\nTwo.');
  });

  it('normalises Windows line endings', () => {
    expect(toPlatformText('One.\r\nTwo.')).toBe('One.\nTwo.');
  });

  it('unescapes markdown escapes into the literal character', () => {
    expect(toPlatformText('10\\* growth, not \\#1')).toBe('10* growth, not #1');
  });
});

it('is idempotent, so cleaning twice cannot change a reply the second time', () => {
  const samples = [
    '**Bold** and *italic*\n\n* bullet\n## Head\n> quote',
    '重點：**具體**\n\n- 一\n- 二',
    'Plain reply with no markup at all.',
  ];
  for (const sample of samples) {
    const once = toPlatformText(sample);
    expect(toPlatformText(once)).toBe(once);
  }
});

