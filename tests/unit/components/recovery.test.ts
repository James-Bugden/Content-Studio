// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { clearRecovery, readRecovery, writeRecovery, type RecoveryEntry } from '@/lib/client/recovery';
import { clearLocalRecovery } from '@/lib/client/local-recovery';

/**
 * SEC-11: tab-local draft recovery is namespaced per session, bounded, holds only
 * the draft being edited, and is cleared on sign-out.
 */
const entry = (libraryId: string, text = 'draft', savedAt = Date.now()): RecoveryEntry => ({
  libraryId,
  text,
  base: 'base',
  sheetRevision: '0000000000000000',
  sectionHash: '0000000000000000',
  savedAt,
});

beforeEach(() => sessionStorage.clear());

describe('SEC-11 tab-local recovery', () => {
  it('is namespaced: another session namespace cannot read it', () => {
    writeRecovery('nsA', entry('SYN-L001', 'mine'));
    expect(readRecovery('nsA', 'SYN-L001')?.text).toBe('mine');
    expect(readRecovery('nsB', 'SYN-L001')).toBeNull();
  });

  it('refuses oversized text and keeps at most 20 entries, evicting the oldest', () => {
    expect(writeRecovery('ns', entry('SYN-BIG', 'a'.repeat(40_001)))).toBe(false);
    for (let i = 0; i < 25; i += 1) writeRecovery('ns', entry(`SYN-${i}`, `t${i}`, 1000 + i));
    const keys = Object.keys(sessionStorage).filter((k) => k.startsWith('cs:draft:'));
    expect(keys.length).toBe(20);
    expect(readRecovery('ns', 'SYN-0')).toBeNull();
    expect(readRecovery('ns', 'SYN-24')?.text).toBe('t24');
  });

  it('stores only the draft fields, never tokens or source archives', () => {
    writeRecovery('ns', entry('SYN-L001'));
    const raw = JSON.parse(sessionStorage.getItem('cs:draft:ns:SYN-L001')!) as Record<string, unknown>;
    expect(Object.keys(raw).sort()).toEqual(['base', 'libraryId', 'savedAt', 'sectionHash', 'sheetRevision', 'text']);
  });

  it('is cleared per item after save and entirely on sign-out', () => {
    writeRecovery('ns', entry('SYN-L001'));
    writeRecovery('ns', entry('SYN-L002'));
    sessionStorage.setItem('unrelated', 'kept');
    clearRecovery('ns', 'SYN-L001');
    expect(readRecovery('ns', 'SYN-L001')).toBeNull();
    clearLocalRecovery();
    expect(readRecovery('ns', 'SYN-L002')).toBeNull();
    expect(sessionStorage.getItem('unrelated')).toBe('kept');
  });
});
