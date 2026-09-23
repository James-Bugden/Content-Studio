import { beforeEach, describe, expect, it } from 'vitest';
import { FakeSheetTransport } from '@/integrations/google/fake-sheet';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';
import { applyReviewTransition, loadReviewQueue, parseReviewFilters, sourceKey, type ReviewTransition } from '@/application/review';
import { approvalState } from '@/domain';
import { SHEET_TABS } from '@/domain/sheet-schema';
import { largeLibraryRows } from '@/fixtures/synthetic';
import type { Actor } from '@/domain/mutation';

const owner: Actor = { sub: '100000000000000000001', role: 'owner' };
const viewer: Actor = { sub: '100000000000000000002', role: 'viewer' };
let sheet: FakeSheetTransport;
let repo: SheetsContentRepository;

beforeEach(() => {
  sheet = new FakeSheetTransport();
  repo = new SheetsContentRepository(sheet);
});

let n = 0;
async function transition(libraryId: string, action: ReviewTransition['action'], extra: Partial<ReviewTransition> = {}, actor = owner) {
  const rec = await repo.getLibrary(libraryId);
  n += 1;
  return applyReviewTransition(repo, actor, { operationId: `op_review_${n}_000`, libraryId, expectedRevision: rec.revision, action, ...extra });
}

describe('REV-03: filters', () => {
  it('drops unknown or free-text values instead of passing them through', () => {
    const f = parseReviewFilters({ lane: 'copyright', target: 'LinkedIn', src: 'not-a-hash', review: '<script>', page: '-3', extra: 'x' });
    expect(f).toEqual({ lane: 'copyright', target: 'LinkedIn', src: undefined, from: undefined, review: undefined, copyright: undefined, duplicate: undefined, queue: undefined, page: 1 });
  });

  it('filters compose and match a direct repository query', async () => {
    const f = parseReviewFilters({ target: 'LinkedIn', review: 'Pending' });
    const q = await loadReviewQueue(repo, f);
    const direct = (await repo.listLibrary()).filter(
      (r) => r.value.targetPlatform.ok && r.value.targetPlatform.value === 'LinkedIn' && r.value.reviewStatus.ok && r.value.reviewStatus.value === 'Pending',
    );
    expect(q.cards.map((c) => c.libraryId)).toEqual(direct.map((r) => r.value.libraryId));
    expect(q.total).toBe(direct.length);
  });

  it('lanes separate clean review, copyright rework and duplicate checks', async () => {
    const q = await loadReviewQueue(repo, parseReviewFilters({}));
    const lane = (id: string) => q.cards.find((c) => c.libraryId === id)?.lane;
    expect(lane('SYN-L001')).toBe('clean');
    expect(lane('SYN-L002')).toBe('copyright');
    expect(lane('SYN-L003')).toBe('duplicate');
    expect(q.laneCounts.copyright).toBe(1);
    expect(q.laneCounts.all).toBe(q.totalUnfiltered);
  });

  it('source keys are hashes, not source names', async () => {
    const q = await loadReviewQueue(repo, parseReviewFilters({}));
    expect(q.sources[0]!.key).toMatch(/^[0-9a-f]{8}$/);
    const byKey = await loadReviewQueue(repo, parseReviewFilters({ src: sourceKey('Synthetic Negotiation Handbook') }));
    expect(byKey.total).toBe(q.totalUnfiltered);
  });

  it('paginates a 1,600-row corpus in 25s and clamps out-of-range pages', async () => {
    const big = new SheetsContentRepository(new FakeSheetTransport({ [SHEET_TABS.library.name]: largeLibraryRows(1600) }));
    const started = performance.now();
    const p1 = await loadReviewQueue(big, parseReviewFilters({}));
    expect(performance.now() - started).toBeLessThan(2000);
    expect(p1.cards).toHaveLength(25);
    expect(p1.pages).toBe(64);
    const last = await loadReviewQueue(big, parseReviewFilters({ page: '999' }));
    expect(last.page).toBe(64);
    expect(last.cards.at(-1)!.libraryId).toBe('SYN-B1600');
  });
});

describe('REV-05: empty, no-match and provider failure are distinct', () => {
  it('no match returns zero cards but keeps the unfiltered total', async () => {
    const q = await loadReviewQueue(repo, parseReviewFilters({ target: 'Threads' }));
    expect(q.total).toBe(0);
    expect(q.totalUnfiltered).toBeGreaterThan(0);
  });

  it('a provider failure throws instead of returning an empty list', async () => {
    sheet.failNext({ op: 'read', code: 'PROVIDER_UNAVAILABLE' });
    await expect(loadReviewQueue(repo, parseReviewFilters({}))).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });

  it('a Schedule outage marks screenshot reuse uncertain rather than clear', async () => {
    sheet.failNext({ op: 'read', tab: 'Content Schedule', code: 'PROVIDER_UNAVAILABLE' });
    const q = await loadReviewQueue(repo, parseReviewFilters({}));
    expect(q.scheduleUnavailable).toBe(true);
    expect(q.cards.find((c) => c.libraryId === 'SYN-L009')!.gates.blockers.map((g) => g.code)).toContain('SCREENSHOT_UNCERTAIN');
  });
});

describe('REV-04 / REV-06: transitions', () => {
  it('approve writes status and a current approval stamp, nothing else', async () => {
    const r = await transition('SYN-L001', 'approve');
    expect(r.ok).toBe(true);
    const rec = await repo.getLibrary('SYN-L001');
    expect(rec.cells.reviewStatus).toBe('Approved');
    expect(approvalState(rec.value)).toBe('approved');
    expect(rec.value.queueForSchedule).toBe(false);
    const written = sheet.writes.flatMap((w) => w.writes.map((c) => c.column));
    const header = sheet.rawTab('Content Library')[0]!.map((c) => c.value);
    expect(written.map((c) => header[c]).sort()).toEqual(['Next Action', 'Review Status']);
  });

  it.each([
    ['SYN-L002', 'COPYRIGHT_REWORK'],
    ['SYN-L003', 'DUPLICATE_CHECK'],
    ['SYN-L011', 'UNRECOGNISED_VALUE'],
  ])('%s cannot be approved or queued while %s', async (id, code) => {
    for (const action of ['approve', 'approve_and_queue'] as const) {
      const r = await transition(id, action);
      expect(r).toMatchObject({ ok: false, code: 'GATE_BLOCKED' });
      if (!r.ok) expect(r.blockers?.map((b) => b.code)).toContain(code);
    }
    expect(sheet.writes).toHaveLength(0);
  });

  it('screenshot reuse on the same platform blocks approval', async () => {
    const r = await transition('SYN-L009', 'approve');
    expect(r).toMatchObject({ ok: false, code: 'GATE_BLOCKED' });
    if (!r.ok) expect(r.blockers?.map((b) => b.code)).toEqual(['SCREENSHOT_REUSED']);
  });

  it('queue requires a current approval', async () => {
    expect(await transition('SYN-L001', 'queue')).toMatchObject({ ok: false, code: 'GATE_BLOCKED' });
    expect(await transition('SYN-L006', 'queue')).toMatchObject({ ok: false, code: 'GATE_BLOCKED' });
    expect((await transition('SYN-L010', 'queue')).ok).toBe(true);
  });

  it('skip and request changes clear the queue', async () => {
    await transition('SYN-L005', 'request_changes', { note: 'Tighten the second line' });
    const rec = await repo.getLibrary('SYN-L005');
    expect(rec.cells.reviewStatus).toBe('Changes Requested');
    expect(rec.cells.queueForSchedule).toBe('FALSE');
    expect(rec.cells.nextAction).toBe('Changes requested: Tighten the second line');
  });

  it('never writes a formula Next Action cell', async () => {
    // SYN-L002 has a formula Next Action; skipping must not touch it.
    const r = await transition('SYN-L002', 'skip');
    expect(r.ok).toBe(true);
    const header = sheet.rawTab('Content Library')[0]!.map((c) => c.value);
    expect(sheet.writes.flatMap((w) => w.writes.map((c) => header[c.column]))).not.toContain('Next Action');
  });

  it('a stale row is refused and returns the current card for comparison', async () => {
    const rec = await repo.getLibrary('SYN-L001');
    const col = sheet.rawTab('Content Library')[0]!.findIndex((c) => c.value === 'Current Hook');
    sheet.externalEdit('Content Library', rec.row, col, 'Changed in the Sheet');
    const r = await applyReviewTransition(repo, owner, { operationId: 'op_review_stale_1', libraryId: 'SYN-L001', expectedRevision: rec.revision, action: 'approve' });
    expect(r).toMatchObject({ ok: false, code: 'STALE_READ' });
    if (!r.ok) expect(r.current?.hook).toBe('Changed in the Sheet');
    expect(sheet.writes).toHaveLength(0);
  });

  it('a viewer cannot transition', async () => {
    expect(await transition('SYN-L001', 'approve', {}, viewer)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });
});
