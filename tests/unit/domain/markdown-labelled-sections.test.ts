import { describe, expect, it } from 'vitest';
import { findSection, safeReplaceSectionBody } from '@/domain/markdown';

/** CS-057: theme-bank files put `Library ID:` under the post heading and the copy in a fence under Working draft. */
const BANK = [
  '# Synthetic Theme Bank',
  '',
  '## Posts',
  '',
  '## 001. Synthetic angle | LinkedIn',
  '',
  'Library ID: SYN-BANK-001-LI',
  'PESTO: Opinions',
  '',
  '### Current hook, preserved pending selection',
  '',
  'Old hook.',
  '',
  '### Three alternative hooks',
  '',
  '1) 8/10 | Opinion #1: A sharper hook.',
  '',
  '### Working draft',
  '',
  'A note for the reviewer, not part of the post.',
  '',
  '```text',
  'Old hook.',
  '',
  'Body of the LinkedIn post.',
  '```',
  '',
  '## 002. Synthetic angle | X',
  '',
  'Library ID: SYN-BANK-002-X',
  '',
  '### Working draft',
  '',
  'Unfenced X copy.',
  '',
].join('\n');

describe('findSection with Library ID lines and Working draft (CS-057)', () => {
  it('finds the copy inside the Working draft fence', () => {
    const found = findSection(BANK, 'SYN-BANK-001-LI');
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.section.body).toBe('Old hook.\n\nBody of the LinkedIn post.');
    expect(found.section.headingLine).toBe('## 001. Synthetic angle | LinkedIn');
  });

  it('uses the Working draft text when there is no fence', () => {
    const found = findSection(BANK, 'SYN-BANK-002-X');
    expect(found.ok && found.section.body).toBe('Unfenced X copy.');
  });

  it('saving changes only the copy; the note, fence, metadata and other posts are unchanged', () => {
    const found = findSection(BANK, 'SYN-BANK-001-LI');
    if (!found.ok) throw new Error('not found');
    const next = safeReplaceSectionBody(BANK, found.section, 'New hook.\n\nNew body.');
    expect(next).toBe(BANK.replace('```text\nOld hook.\n\nBody of the LinkedIn post.\n```', '```text\nNew hook.\n\nNew body.\n```'));
  });

  it('refuses copy that would close the fence or add a heading', () => {
    const found = findSection(BANK, 'SYN-BANK-001-LI');
    if (!found.ok) throw new Error('not found');
    expect(safeReplaceSectionBody(BANK, found.section, 'Text\n```\nmore')).toBeNull();
    expect(safeReplaceSectionBody(BANK, found.section, 'Text\n## Not a post')).toBeNull();
  });

  it('an unknown id or a repeated Library ID is not editable', () => {
    expect(findSection(BANK, 'SYN-BANK-404')).toMatchObject({ ok: false, reason: 'missing' });
    const twice = `${BANK}\n## 003. Copy | LinkedIn\n\nLibrary ID: SYN-BANK-002-X\n\n### Working draft\n\nAgain.\n`;
    expect(findSection(twice, 'SYN-BANK-002-X')).toMatchObject({ ok: false, reason: 'duplicate' });
  });
});
