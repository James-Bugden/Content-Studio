import { beforeAll, describe, expect, it } from 'vitest';
import { FakeSheetTransport } from '@/integrations/google/fake-sheet';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';
import { loadBoard } from '@/application/board';
import { loadReviewQueue, parseReviewFilters } from '@/application/review';

beforeAll(() => {
  process.env.CS_FAKE_TODAY = '2026-09-30';
});

describe('Next up and Posts tell the same story (UX redesign)', () => {
  it('tab counts on Posts match the Next up tiles', async () => {
    const repo = new SheetsContentRepository(new FakeSheetTransport());
    const board = await loadBoard(repo);
    const queue = await loadReviewQueue(repo, parseReviewFilters({}));
    expect(queue.laneCounts.review).toBe(board.counts.review);
    expect(queue.laneCounts.image).toBe(board.counts.images);
    expect(queue.laneCounts.ready).toBe(board.counts.ready);
    for (const tab of ['review', 'image', 'ready', 'scheduled', 'published', 'blocked'] as const) {
      expect(queue.laneCounts[tab]).toBe(board.posts.filter((p) => p.tab === tab).length);
    }
  });

  it('every card carries a thumb, a step and a pill per column', async () => {
    const repo = new SheetsContentRepository(new FakeSheetTransport());
    const queue = await loadReviewQueue(repo, parseReviewFilters({ lane: 'blocked' }));
    const rework = queue.cards.find((c) => c.libraryId === 'SYN-L002');
    expect(rework?.pills.qa).toEqual({ label: 'REWORK', tone: 'problem' });
    expect(rework?.step.action).toBe('Rework copy');
    expect(queue.cards.every((c) => c.tab === 'blocked')).toBe(true);
    const withImage = (await loadReviewQueue(repo, parseReviewFilters({}))).cards.find((c) => c.libraryId === 'SYN-L012');
    expect(withImage?.thumb.src).toContain('/api/library/SYN-L012/');
  });

  it('old lane links still filter by their earlier meaning', async () => {
    const repo = new SheetsContentRepository(new FakeSheetTransport());
    const q = await loadReviewQueue(repo, parseReviewFilters({ lane: 'copyright' }));
    expect(q.cards.map((c) => c.libraryId)).toEqual(['SYN-L002']);
  });

  it('the urgent synthetic tasks are all in the now list with readable titles', async () => {
    const board = await loadBoard(new SheetsContentRepository(new FakeSheetTransport()));
    const now = board.tasks.filter((t) => t.step.urgency === 'now').map((t) => t.step.action);
    expect(now).toEqual(expect.arrayContaining(['Update Chinese', 'Rework copy', 'Decide duplicate']));
  });
});
