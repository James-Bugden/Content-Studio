import { describe, expect, it } from 'vitest';
import { findSection, replaceSectionBody } from '@/domain';
import { SYNTH_MARKDOWN, SYNTH_MASTER_FILE_ID } from '@/fixtures/synthetic';

const source = SYNTH_MARKDOWN[SYNTH_MASTER_FILE_ID]!;
const FENCE = '`'.repeat(3);

describe('DRV-01: Library-ID sections round-trip exactly', () => {
  it('finds the section body without frame blank lines', () => {
    const r = findSection(source, 'SYN-L005');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.section.body).toBe('A counteroffer is information, not an insult.\n\nAsk what changed.\nThen decide.');
  });

  it('keeps CJK, emoji and trailing spaces in the body', () => {
    const r = findSection(source, 'SYN-L008');
    if (!r.ok) throw new Error('missing');
    expect(r.section.body.endsWith('not a demand.  ')).toBe(true);
    expect(r.section.body.startsWith('談薪水不是吵架 🙂')).toBe(true);
  });

  it('replacing one body leaves every other byte identical', () => {
    const r = findSection(source, 'SYN-L005');
    if (!r.ok) throw new Error('missing');
    const body = 'New body\n\n第二行 ✓';
    const next = replaceSectionBody(source, r.section, body);
    expect(next.slice(0, r.section.bodyStart)).toBe(source.slice(0, r.section.bodyStart));
    expect(next.slice(r.section.bodyStart + body.length)).toBe(source.slice(r.section.bodyEnd));
    const again = findSection(next, 'SYN-L005');
    if (!again.ok) throw new Error('lost');
    expect(again.section.body).toBe(body);
    for (const other of ['SYN-L001', 'SYN-X004', 'SYN-L008']) {
      const a = findSection(source, other);
      const b = findSection(next, other);
      if (!a.ok || !b.ok) throw new Error('lost other');
      expect(b.section.body).toBe(a.section.body);
    }
  });

  it('preserves CRLF line endings outside the body', () => {
    const crlf = '# T\r\n\r\n## A-1 x\r\n\r\nbody one\r\nline two\r\n\r\n## A-2 y\r\n\r\nother\r\n';
    const r = findSection(crlf, 'A-1');
    if (!r.ok) throw new Error('missing');
    expect(r.section.body).toBe('body one\r\nline two');
    expect(replaceSectionBody(crlf, r.section, 'changed')).toBe('# T\r\n\r\n## A-1 x\r\n\r\nchanged\r\n\r\n## A-2 y\r\n\r\nother\r\n');
  });

  it('matches whole tokens only', () => {
    expect(findSection(source, 'SYN-L00')).toEqual({ ok: false, reason: 'missing', count: 0 });
  });

  it('ignores headings inside fenced code', () => {
    const md = `## Z-1 real\n\nbody\n\n${FENCE}\n## Z-1 fake\n${FENCE}\n`;
    expect(findSection(md, 'Z-1').ok).toBe(true);
  });
});

describe('DRV-02: missing and duplicate ids are refused', () => {
  it('missing', () => expect(findSection(source, 'SYN-L999')).toMatchObject({ ok: false, reason: 'missing' }));
  it('duplicate', () => expect(findSection(source, 'SYN-L003')).toMatchObject({ ok: false, reason: 'duplicate', count: 2 }));
});

describe('empty sections', () => {
  it('writes into an empty trailing section with its own lines', () => {
    const md = '## E-1 empty';
    const r = findSection(md, 'E-1');
    if (!r.ok) throw new Error('missing');
    expect(r.section.body).toBe('');
    expect(replaceSectionBody(md, r.section, 'hello')).toBe('## E-1 empty\n\nhello');
  });

  it('writes into an empty middle section', () => {
    const md = '## E-1 empty\n\n## E-2 next\n\nx';
    const r = findSection(md, 'E-1');
    if (!r.ok) throw new Error('missing');
    expect(replaceSectionBody(md, r.section, 'hello')).toBe('## E-1 empty\n\nhello\n\n## E-2 next\n\nx');
  });
});
