import { describe, expect, it } from 'vitest';
import { placeHookInText } from '@/domain/hook-text';

describe('placeHookInText', () => {
  it('replaces the opening line when it is the previous hook', () => {
    const r = placeHookInText('Old hook\n\nBody one.\n\nBody two.', 'New hook', 'Old hook');
    expect(r).toEqual({ text: 'New hook\n\nBody one.\n\nBody two.', mode: 'replaced' });
  });

  it('replaces a first paragraph that equals the previous hook', () => {
    const r = placeHookInText('Old hook line one\nline two\n\nBody.', 'New hook', 'Old hook line one\nline two');
    expect(r).toEqual({ text: 'New hook\n\nBody.', mode: 'replaced' });
  });

  it('prepends a new first paragraph when the opening is not the previous hook', () => {
    const r = placeHookInText('Something else first.\n\nBody.', 'New hook', 'Old hook');
    expect(r).toEqual({ text: 'New hook\n\nSomething else first.\n\nBody.', mode: 'prepended' });
  });

  it('does nothing when the hook is already the first line', () => {
    const text = 'New hook\n\nBody.';
    expect(placeHookInText(text, 'New hook', 'Old hook')).toEqual({ text, mode: 'unchanged' });
    expect(placeHookInText(text, '  New   hook ', '')).toEqual({ text, mode: 'unchanged' });
  });

  it('writes just the hook into an empty draft', () => {
    expect(placeHookInText('', 'New hook', '')).toEqual({ text: 'New hook', mode: 'prepended' });
    expect(placeHookInText('  \n', 'New hook', 'Old')).toEqual({ text: 'New hook', mode: 'prepended' });
  });

  it('without a saved hook replaces the first paragraph of a multi-paragraph post', () => {
    expect(placeHookInText('First para.\n\nSecond para.', 'New hook', '').text).toBe('New hook\n\nSecond para.');
  });

  it('without a saved hook never replaces a post that is a single paragraph', () => {
    expect(placeHookInText('Only paragraph.', 'New hook', '')).toEqual({ text: 'New hook\n\nOnly paragraph.', mode: 'prepended' });
  });

  it('keeps CRLF text intact', () => {
    const replaced = placeHookInText('Old hook\r\n\r\nBody.\r\nMore.', 'New hook', 'Old hook');
    expect(replaced.text).toBe('New hook\r\n\r\nBody.\r\nMore.');
    const prepended = placeHookInText('Body.\r\nMore.', 'New hook', 'Old hook');
    expect(prepended.text).toBe('New hook\r\n\r\nBody.\r\nMore.');
  });

  it('ignores an empty hook', () => {
    expect(placeHookInText('Body.', '   ', 'Old')).toEqual({ text: 'Body.', mode: 'unchanged' });
  });
});
