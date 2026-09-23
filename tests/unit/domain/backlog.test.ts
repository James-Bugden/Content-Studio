import { describe, expect, it } from 'vitest';
import { backlogPills, postTab, type BacklogFacts } from '@/domain/backlog';
import type { GateCode } from '@/domain/gates';

const facts = (codes: GateCode[], over: Partial<BacklogFacts> = {}): BacklogFacts => ({
  gates: { blockers: codes.map((code) => ({ code, level: 'block', field: 'x', message: 'm', nextAction: 'n' }) as never) },
  reviewStatus: 'Pending',
  platform: 'LinkedIn',
  thumb: { src: null, label: 'Text only', tone: 'done' },
  scheduled: [],
  ...over,
});

describe('backlog pills (UX redesign)', () => {
  it('shows a clean post as done, not reviewed, not scheduled', () => {
    const p = backlogPills(facts(['REVIEW_PENDING']));
    expect(p.copy).toEqual({ label: 'Done', tone: 'done' });
    expect(p.qa).toEqual({ label: 'Cleared', tone: 'done' });
    expect(p.review).toEqual({ label: 'Not reviewed', tone: 'todo' });
    expect(p.image).toEqual({ label: 'Text only', tone: 'done' });
    expect(p.chinese).toEqual({ label: 'n/a', tone: 'none' });
    expect(p.scheduled).toEqual({ label: 'Not yet', tone: 'none' });
  });

  it('marks copyright rework and duplicate checks as problems in words', () => {
    const rework = backlogPills(facts(['COPYRIGHT_REWORK']));
    expect(rework.copy.label).toBe('Rework');
    expect(rework.qa).toEqual({ label: 'REWORK', tone: 'problem' });
    expect(backlogPills(facts(['DUPLICATE_CHECK'])).qa).toEqual({ label: 'Duplicate?', tone: 'problem' });
    expect(backlogPills(facts(['MISSING_COPY'])).copy).toEqual({ label: 'Write', tone: 'todo' });
    expect(backlogPills(facts(['COPYRIGHT_UNCHECKED'])).qa.label).toBe('Not checked');
  });

  it('reads review state, including a stale approval', () => {
    expect(backlogPills(facts([], { reviewStatus: 'Approved' })).review.label).toBe('Approved');
    expect(backlogPills(facts(['APPROVAL_STALE'], { reviewStatus: 'Approved' })).review).toEqual({ label: 'Stale', tone: 'problem' });
    expect(backlogPills(facts([], { reviewStatus: 'Changes Requested' })).review.label).toBe('Changes');
    expect(backlogPills(facts([], { reviewStatus: null })).review.tone).toBe('problem');
  });

  it('shows the Chinese state for X posts from their scheduled rows', () => {
    const x = (zh?: 'missing' | 'stale' | 'approved') =>
      backlogPills(facts([], { platform: 'X', scheduled: [{ contentId: '2026-10-02-MAIN-X', isoDate: '2026-10-02', slot: 'Main', platform: 'X', published: false, ...(zh ? { zh } : {}) }] }));
    expect(x('missing').chinese).toEqual({ label: 'Needs version', tone: 'todo' });
    expect(x('stale').chinese.tone).toBe('problem');
    expect(x('approved').chinese.label).toBe('Approved');
    expect(backlogPills(facts([], { platform: 'X' })).chinese.label).toBe('After scheduling');
    expect(x('missing').scheduled.label).toBe('Fri 2 Oct, Main');
  });

  it('says Published once every scheduled row is published', () => {
    const p = backlogPills(facts([], { scheduled: [{ contentId: 'a', isoDate: '2026-10-01', slot: 'Main', platform: 'LinkedIn', published: true }] }));
    expect(p.scheduled).toEqual({ label: 'Published', tone: 'done' });
  });
});

describe('postTab', () => {
  it('puts each post in one tab, matching the Next up counts', () => {
    expect(postTab({ kind: 'review' }, [], 'needs_action')).toBe('review');
    expect(postTab({ kind: 'finish_image' }, [], 'needs_action')).toBe('image');
    expect(postTab({ kind: 'schedule' }, [], 'ready')).toBe('ready');
    expect(postTab({ kind: 'fix_copy' }, [], 'blocked')).toBe('blocked');
    expect(postTab({ kind: 'wait' }, [], 'blocked')).toBe('blocked');
    expect(postTab({ kind: 'done' }, [{ published: false }], 'ready')).toBe('scheduled');
    expect(postTab({ kind: 'done' }, [{ published: true }], 'ready')).toBe('published');
    expect(postTab({ kind: 'done' }, [], 'needs_action')).toBeNull();
  });
});
