import { describe, expect, it } from 'vitest';
import {
  LIBRARY_HEADERS,
  discoverHeaders,
  evaluateLibraryGates,
  toLibraryRecord,
  approvalState,
  checkTransition,
  formatApprovalNote,
  type GateCode,
  type GateContext,
  type LibraryItem,
} from '@/domain';
import { syntheticLibraryRows } from '@/fixtures/synthetic';

const [head, ...rows] = syntheticLibraryRows();
const found = discoverHeaders(LIBRARY_HEADERS, head!.values);
if (!found.ok) throw new Error('fixture drift');
const index = found.index;
const items = new Map(
  rows.map((r, i) => {
    const rec = toLibraryRecord(index, r, i + 2);
    return [rec.value.libraryId, rec.value] as const;
  }),
);
const item = (id: string) => items.get(id)!;
const codes = (i: LibraryItem, ctx: GateContext) => evaluateLibraryGates(i, ctx).blockers.map((g) => g.code);

describe('READY-01: table-driven hard gates', () => {
  const cases: [string, GateContext, GateCode[], 'ready' | 'needs_action' | 'blocked'][] = [
    ['SYN-L001', { purpose: 'review' }, ['REVIEW_PENDING'], 'needs_action'],
    ['SYN-L002', { purpose: 'review' }, ['COPYRIGHT_REWORK', 'REVIEW_PENDING', 'VISUAL_UNDECIDED'], 'blocked'],
    ['SYN-L003', { purpose: 'review' }, ['DUPLICATE_CHECK', 'REVIEW_PENDING', 'VISUAL_UNDECIDED'], 'blocked'],
    ['SYN-X004', { purpose: 'ready', zh: 'missing' }, ['ZH_ADAPTATION_MISSING'], 'needs_action'],
    ['SYN-X004', { purpose: 'ready', zh: 'stale' }, ['ZH_ADAPTATION_STALE'], 'blocked'],
    ['SYN-X004', { purpose: 'ready', zh: 'awaiting_review' }, ['ZH_ADAPTATION_NOT_REVIEWED'], 'needs_action'],
    ['SYN-X004', { purpose: 'ready', zh: 'ambiguous' }, ['ZH_ADAPTATION_AMBIGUOUS'], 'blocked'],
    ['SYN-X004', { purpose: 'ready', zh: 'approved' }, [], 'ready'],
    ['SYN-L005', { purpose: 'ready' }, [], 'ready'],
    ['SYN-L006', { purpose: 'ready' }, ['APPROVAL_STALE', 'QUEUED_WITHOUT_APPROVAL'], 'blocked'],
    ['SYN-L007', { purpose: 'ready' }, ['VISUAL_BRIEF_INCOMPLETE', 'VISUAL_ALT_TEXT_MISSING', 'VISUAL_NOT_APPROVED'], 'needs_action'],
    [
      'SYN-L009',
      { purpose: 'review', screenshotUses: [{ platform: 'LinkedIn', contentId: '2026-10-02-MAIN-LI' }] },
      ['REVIEW_PENDING', 'SCREENSHOT_REUSED', 'VISUAL_NOT_APPROVED'],
      'blocked',
    ],
    ['SYN-L009', { purpose: 'review', screenshotUses: [{ platform: 'X' }] }, ['REVIEW_PENDING', 'VISUAL_NOT_APPROVED'], 'needs_action'],
    ['SYN-L009', { purpose: 'review', screenshotUses: null }, ['REVIEW_PENDING', 'SCREENSHOT_UNCERTAIN', 'VISUAL_NOT_APPROVED'], 'blocked'],
    ['SYN-L010', { purpose: 'ready', screenshotUses: [] }, ['QUEUE_NOT_SET'], 'needs_action'],
    ['SYN-L011', { purpose: 'review' }, ['UNRECOGNISED_VALUE', 'VISUAL_UNDECIDED'], 'blocked'],
    ['SYN-L012', { purpose: 'ready' }, [], 'ready'],
    ['SYN-L001', { purpose: 'review', markdown: 'mismatch' }, ['MARKDOWN_MISMATCH', 'REVIEW_PENDING'], 'blocked'],
  ];

  it.each(cases)('%s %j -> %j (%s)', (id, ctx, expected, status) => {
    const result = evaluateLibraryGates(item(id), ctx);
    expect(result.blockers.map((g) => g.code)).toEqual(expected);
    expect(result.status).toBe(status);
    if (expected.length > 0) expect(result.next?.code).toBe(expected[0]);
    else expect(result.next === null || result.next.severity === 'soft').toBe(true);
  });

  it('every blocker explains itself and names a next action', () => {
    for (const i of items.values()) {
      for (const gate of evaluateLibraryGates(i, { purpose: 'ready', zh: 'missing', screenshotUses: null }).blockers) {
        expect(gate.message.length).toBeGreaterThan(10);
        expect(gate.nextAction.length).toBeGreaterThan(5);
        expect(gate.field.length).toBeGreaterThan(0);
      }
    }
  });

  it('LinkedIn never requires a zh-TW adaptation', () => {
    expect(codes(item('SYN-L005'), { purpose: 'ready', zh: 'missing' })).toEqual([]);
  });

  it('queue checkbox without approval stays blocked', () => {
    const queued = { ...item('SYN-L001'), queueForSchedule: true };
    expect(codes(queued, { purpose: 'ready' })).toContain('QUEUED_WITHOUT_APPROVAL');
  });

  it('a legacy approval is a soft warning', () => {
    const r = evaluateLibraryGates(item('SYN-L007'), { purpose: 'ready' });
    expect(r.warnings.map((w) => w.code)).toEqual(['APPROVAL_LEGACY']);
  });
});

describe('REV-01: approval invalidation and stage transitions', () => {
  it('approval stamp matches until a material field changes', () => {
    const l5 = item('SYN-L005');
    expect(approvalState(l5)).toBe('approved');
    const changes: Partial<LibraryItem>[] = [
      { draftContent: `${l5.draftContent} ` },
      { currentHook: 'Different hook' },
      { visual: { ...l5.visual, source: { kind: 'original_graphic' } } },
      { targetPlatform: { ok: true, value: 'X' } },
    ];
    for (const change of changes) expect(approvalState({ ...l5, ...change })).toBe('stale');
    expect(approvalState({ ...l5, pesto: 'Opinions' })).toBe('approved');
  });

  it('re-approval produces a matching stamp', () => {
    const l6 = item('SYN-L006');
    expect(approvalState(l6)).toBe('stale');
    expect(approvalState({ ...l6, nextAction: formatApprovalNote(l6) })).toBe('approved');
  });

  it.each([
    ['X', 'EN Review', 'EN Approved', undefined, true],
    ['X', 'EN Approved', 'Translation', undefined, true],
    ['X', 'EN Approved', 'Ready', undefined, false],
    ['LinkedIn', 'EN Approved', 'Ready', undefined, true],
    ['LinkedIn', 'EN Approved', 'Translation', undefined, false],
    ['X', 'Idea', 'EN Review', undefined, false],
    ['X', 'ZH Review', 'Drafting', undefined, false],
    ['X', 'ZH Review', 'Drafting', 'X copy changed', true],
  ] as const)('%s %s -> %s (reason %s) allowed=%s', (platform, from, to, reason, ok) => {
    expect(checkTransition(platform, from, to, reason).ok).toBe(ok);
  });
});
