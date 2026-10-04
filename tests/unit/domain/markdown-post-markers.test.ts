import { describe, expect, it } from 'vitest';
import { findSection, safeReplaceSectionBody } from '@/domain/markdown';

/** CS-055: review-export master files mark each post with POST_START/POST_END comments. */
const MASTER = [
  '# Synthetic Book — Master Posts',
  '',
  '## 001. synth-first-idea',
  '',
  '### LinkedIn — synth-first-idea',
  '',
  '<!-- POST_START library_id="MD-SYNTH_aaaaaaaaaaaa" sheet_row="10" -->',
  '',
  'Decision: PENDING',
  '',
  'Library ID: MD-SYNTH_aaaaaaaaaaaa',
  '',
  '#### Draft',
  '',
  'First line of the LinkedIn post.',
  '',
  'Second paragraph.',
  '',
  '<!-- POST_END -->',
  '',
  '### X — synth-first-idea',
  '',
  '<!-- POST_START library_id="MD-SYNTH_bbbbbbbbbbbb" sheet_row="11" -->',
  '',
  'Decision: PENDING',
  '',
  '#### Draft',
  '',
  'The X version.',
  '',
  '<!-- POST_END -->',
  '',
].join('\n');

describe('findSection with POST_START markers (CS-055)', () => {
  it('finds the Draft body inside the post\'s own markers', () => {
    const found = findSection(MASTER, 'MD-SYNTH_aaaaaaaaaaaa');
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.section.body).toBe('First line of the LinkedIn post.\n\nSecond paragraph.');
    expect(found.section.headingLine).toBe('### LinkedIn — synth-first-idea');
    expect(found.section.level).toBe(4);
  });

  it('keeps each post separate', () => {
    const x = findSection(MASTER, 'MD-SYNTH_bbbbbbbbbbbb');
    expect(x.ok && x.section.body).toBe('The X version.');
  });

  it('saving replaces only that Draft body; markers, metadata and the other post are unchanged', () => {
    const found = findSection(MASTER, 'MD-SYNTH_aaaaaaaaaaaa');
    if (!found.ok) throw new Error('not found');
    const next = safeReplaceSectionBody(MASTER, found.section, 'Rewritten post.');
    expect(next).toBe(MASTER.replace('First line of the LinkedIn post.\n\nSecond paragraph.', 'Rewritten post.'));
  });

  it('refuses a body that would break the post markers', () => {
    const found = findSection(MASTER, 'MD-SYNTH_aaaaaaaaaaaa');
    if (!found.ok) throw new Error('not found');
    expect(safeReplaceSectionBody(MASTER, found.section, 'Text\n\n<!-- POST_END -->\n\nmore')).toBeNull();
    expect(safeReplaceSectionBody(MASTER, found.section, 'Text\n\n#### Draft\n\nagain')).toBeNull();
  });

  it('an unknown id, a duplicated marker or a post with no Draft heading is not editable', () => {
    expect(findSection(MASTER, 'MD-SYNTH_cccccccccccc')).toMatchObject({ ok: false, reason: 'missing' });
    const twice = MASTER + '\n<!-- POST_START library_id="MD-SYNTH_bbbbbbbbbbbb" -->\n\n#### Draft\n\nCopy\n\n<!-- POST_END -->\n';
    expect(findSection(twice, 'MD-SYNTH_bbbbbbbbbbbb')).toMatchObject({ ok: false, reason: 'duplicate' });
    const noDraft = '<!-- POST_START library_id="MD-SYNTH_dddddddddddd" -->\n\nDecision: PENDING\n\n<!-- POST_END -->\n';
    expect(findSection(noDraft, 'MD-SYNTH_dddddddddddd')).toMatchObject({ ok: false, reason: 'missing' });
  });

  it('a heading naming the Library ID still wins over a marker', () => {
    const both = `## MD-SYNTH_aaaaaaaaaaaa\n\nHeading body.\n\n${MASTER}`;
    const found = findSection(both, 'MD-SYNTH_aaaaaaaaaaaa');
    expect(found.ok && found.section.body).toBe('Heading body.');
  });
});
