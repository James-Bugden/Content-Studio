import { describe, expect, it } from 'vitest';
import { longDate, nextLine, platformName, readableTitle, sentenceCase, shortWhen, splitTasks, taskTitle } from '@/domain/display';

describe('display helpers (UX redesign)', () => {
  it('turns a slug into a readable sentence-case title', () => {
    expect(readableTitle('negotiate-scope-first')).toBe('Negotiate scope first');
    expect(readableTitle('  offer--email_teardown ')).toBe('Offer email teardown');
    expect(readableTitle('')).toBe('');
    expect(sentenceCase('ask for the band.')).toBe('Ask for the band.');
    expect(sentenceCase('先問薪資範圍。')).toBe('先問薪資範圍。');
  });

  it('names platforms for badges and never shows a raw enum', () => {
    expect(platformName('LinkedIn')).toBe('LinkedIn');
    expect(platformName('x')).toBe('X');
    expect(platformName('Threads')).toBe('Threads');
    expect(platformName('Unrecognised: Myspace')).toBe('Unknown platform');
  });

  it('formats Taipei dates in words', () => {
    expect(longDate('2026-09-30')).toBe('Wednesday 30 September 2026');
    expect(longDate('2026-02-31')).toBe('');
    expect(shortWhen({ isoDate: '2026-10-01', time: '20:00' })).toBe('Thu 1 Oct, 20:00');
    expect(shortWhen({ isoDate: '2026-10-01', time: 'No time' })).toBe('Thu 1 Oct');
  });

  it('writes the next step as one line and keeps acronyms and names', () => {
    expect(nextLine({ action: 'Rework copy', why: 'Copyright QA says this needs rework.' })).toBe('Next: Rework copy, copyright QA says this needs rework.');
    expect(nextLine({ action: 'Update Chinese', why: 'X copy changed.' })).toBe('Next: Update Chinese, X copy changed.');
    expect(nextLine({ action: 'Review', why: 'QA passed.' })).toBe('Next: Review, QA passed.');
    expect(nextLine({ action: 'Open', why: '' })).toBe('Next: Open');
  });

  it('never uses an id as a task title', () => {
    expect(taskTitle({ title: 'walk away number', platform: 'LinkedIn', target: { post: 'SYN-L006' } })).toBe('Walk away number');
    expect(taskTitle({ title: 'SYN-L006', platform: 'LinkedIn', target: { post: 'SYN-L006' } })).toBe('Untitled post');
    expect(taskTitle({ title: '2026-10-01-2ND-X', platform: 'X', target: { slot: '2026-10-01-2ND-X' } })).toBe('X slot');
  });

  it('splits tasks into now, the first 12 soon, and the rest', () => {
    const t = (urgency: 'now' | 'soon' | 'later', i: number) => ({ key: `${urgency}${i}`, step: { urgency } });
    const tasks = [...Array.from({ length: 3 }, (_, i) => t('now', i)), ...Array.from({ length: 15 }, (_, i) => t('soon', i)), t('later', 0)];
    const { now, next, more } = splitTasks(tasks, 12);
    expect(now).toHaveLength(3);
    expect(next).toHaveLength(12);
    expect(more.map((x) => x.key)).toEqual(['soon12', 'soon13', 'soon14']);
    expect(splitTasks([])).toEqual({ now: [], next: [], more: [] });
  });
});
