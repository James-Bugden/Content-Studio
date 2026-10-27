import { describe, expect, it } from 'vitest';
import { COALESCE_MS, emptyHistory, HISTORY_CAP, mapOffset, pushHistory, redoHistory, undoHistory, type Snapshot } from '@/domain/edit-history';

const snap = (text: string, start = 0, end = start): Snapshot => ({ text, start, end });

describe('edit history reducer', () => {
  it('pushes programmatic edits and undoes then redoes them', () => {
    const h = pushHistory(emptyHistory, snap('one', 1), 'edit', 1000);
    expect(h.past).toEqual([snap('one', 1)]);
    const undone = undoHistory(h, snap('ONE', 3))!;
    expect(undone.snapshot).toEqual(snap('one', 1));
    expect(undone.history.past).toEqual([]);
    const redone = redoHistory(undone.history, snap('one', 1))!;
    expect(redone.snapshot).toEqual(snap('ONE', 3));
    expect(redone.history.past).toEqual([snap('one', 1)]);
  });

  it('coalesces typing bursts inside the window and splits them after it', () => {
    let h = pushHistory(emptyHistory, snap(''), 'type', 1000);
    h = pushHistory(h, snap('a'), 'type', 1000 + COALESCE_MS - 1);
    h = pushHistory(h, snap('ab'), 'type', 1000 + COALESCE_MS - 1 + COALESCE_MS);
    expect(h.past.map((s) => s.text)).toEqual(['', 'ab']);
  });

  it('measures the burst from the last keystroke, not the first', () => {
    let h = pushHistory(emptyHistory, snap(''), 'type', 0);
    for (let t = 400; t <= 2000; t += 400) h = pushHistory(h, snap(`x${t}`), 'type', t);
    expect(h.past).toHaveLength(1);
  });

  it('never coalesces a programmatic edit into typing and clears redo', () => {
    let h = pushHistory(emptyHistory, snap(''), 'type', 1000);
    h = pushHistory(h, snap('abc'), 'edit', 1100);
    expect(h.past.map((s) => s.text)).toEqual(['', 'abc']);
    h = pushHistory(undoHistory(h, snap('ABC'))!.history, snap('abc'), 'edit', 1200);
    expect(h.future).toEqual([]);
    h = pushHistory(h, snap('after'), 'type', 1300);
    expect(h.past.at(-1)!.text).toBe('after');
  });

  it('keeps at most the cap, dropping the oldest', () => {
    let h = emptyHistory;
    for (let i = 0; i < HISTORY_CAP + 25; i += 1) h = pushHistory(h, snap(String(i)), 'edit', i);
    expect(h.past).toHaveLength(HISTORY_CAP);
    expect(h.past[0]!.text).toBe('25');
  });

  it('returns null when there is nothing to undo or redo', () => {
    expect(undoHistory(emptyHistory, snap('x'))).toBeNull();
    expect(redoHistory(emptyHistory, snap('x'))).toBeNull();
  });

  it('programmatic edit then undo restores the original text and caret', () => {
    const original = snap('Line one\n\nLine two', 4, 9);
    const h = pushHistory(emptyHistory, original, 'edit', 5);
    expect(undoHistory(h, snap('Line one\nLine two', 4, 4))!.snapshot).toEqual(original);
  });
});

describe('mapOffset', () => {
  it('keeps a caret on the same word when only line breaks change', () => {
    const before = 'Alpha\n\nBeta\n\nGamma';
    const after = 'Alpha\nBeta\nGamma';
    const pos = before.indexOf('Gamma') + 2;
    expect(after.slice(mapOffset(before, after, pos))).toBe('mma');
    expect(mapOffset(before, after, 0)).toBe(0);
    expect(mapOffset(before, after, before.length)).toBe(after.length);
  });

  it('shifts positions after an insertion and keeps positions before it', () => {
    const before = 'Body text here';
    const after = 'New hook\n\nBody text here';
    expect(mapOffset(before, after, 0)).toBe(0);
    expect(after.slice(mapOffset(before, after, 5))).toBe('text here');
  });
});
