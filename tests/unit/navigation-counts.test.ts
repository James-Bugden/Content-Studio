import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadBoard } from '@/application/board';
import { buildReconcileReport } from '@/application/reconcile';
import { cachedNavigationCounts, fixIssuesCount, nextUpCount, rememberNavigationCount } from '@/application/navigation-counts';
import { FakeSheetTransport } from '@/integrations/google/fake-sheet';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';
import { FakeDriveGateway } from '@/integrations/google/fake-drive';
import { FakeTypefullyGateway } from '@/integrations/typefully/fake-gateway';
import { SHEET_TABS } from '@/domain/sheet-schema';

afterEach(() => vi.restoreAllMocks());

function setup(ttl = 15_000) {
  const sheet = new FakeSheetTransport();
  const repo = new SheetsContentRepository(sheet, { writable: true, readCacheMs: ttl });
  const drive = new FakeDriveGateway();
  const typefully = new FakeTypefullyGateway();
  return { sheet, repo, drive, typefully };
}

describe('CS-044 cache-only navigation counts', () => {
  it('matches Do these now and counts blocking reconciliation items only', async () => {
    const { repo, drive, typefully } = setup();
    const board = await loadBoard(repo);
    expect(nextUpCount(board)).toBe(board.tasks.filter((task) => task.step.urgency === 'now').length);
    expect(nextUpCount({ tasks: [] })).toBe(0);
    const report = await buildReconcileReport(repo, drive, undefined, { typefully });
    expect(report.items.some((item) => item.severity === 'attention')).toBe(true);
    expect(fixIssuesCount(report)).toBe(report.items.filter((item) => item.severity === 'blocking').length);
    expect(fixIssuesCount({ items: [], unreadable: [] })).toBe(0);
    expect(fixIssuesCount({ ...report, unreadable: ['synthetic unavailable source'] })).toBeNull();
  });

  it('adds ZERO Sheet, Drive or Typefully calls on cold, warm and expired navigation reads', async () => {
    const { sheet, repo, drive, typefully } = setup();
    const driveRead = vi.spyOn(drive, 'readText');
    expect(cachedNavigationCounts(repo)).toMatchObject({ nextUp: null, fixIssues: null });
    expect(sheet.reads).toBe(0);
    const board = await loadBoard(repo);
    const report = await buildReconcileReport(repo, drive, undefined, { typefully });
    const before = { sheet: sheet.reads, drive: driveRead.mock.calls.length, typefully: typefully.calls.length };
    expect(before.sheet).toBe(7); // board's 3 tabs + Fix issues' 4 header checks; tab data reused
    for (let i = 0; i < 10; i++) {
      expect(cachedNavigationCounts(repo)).toMatchObject({ nextUp: nextUpCount(board), fixIssues: fixIssuesCount(report) });
    }
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 15_001);
    expect(cachedNavigationCounts(repo)).toMatchObject({ nextUp: null, fixIssues: null });
    expect({ sheet: sheet.reads, drive: driveRead.mock.calls.length, typefully: typefully.calls.length }).toEqual(before);
  });

  it('reuses existing last-good snapshots even in zero-retention fake mode', async () => {
    const { sheet, repo } = setup(0);
    const board = await loadBoard(repo);
    expect(cachedNavigationCounts(repo).nextUp).toBe(nextUpCount(board));
    expect(sheet.reads).toBe(3);
  });

  it('hides incomplete board/report results and failed cached reads rather than claiming zero', async () => {
    const { sheet, repo, drive } = setup(0);
    await loadBoard(repo);
    sheet.failNext({ op: 'read', tab: SHEET_TABS.schedule.name, code: 'RATE_LIMITED' });
    await loadBoard(repo);
    expect(cachedNavigationCounts(repo).nextUp).toBeNull();
    drive.failNext({ op: 'read', code: 'PROVIDER_UNAVAILABLE' });
    const report = await buildReconcileReport(repo, drive);
    expect(report.unreadable.length).toBeGreaterThan(0);
    expect(cachedNavigationCounts(repo).fixIssues).toBeNull();
  });

  it('existing mutation invalidation removes badges without adding a read or changing writes', async () => {
    const { sheet, repo } = setup();
    await loadBoard(repo);
    const library = await repo.getLibrary('SYN-L001');
    expect((await repo.updateLibrary({
      operationId: 'op_nav_count_93', actor: { sub: 'synthetic-owner', role: 'owner' },
      target: { libraryId: 'SYN-L001' }, expectedRevision: library.revision,
      patch: { draftContent: 'Synthetic updated draft' },
    })).ok).toBe(true);
    const before = sheet.reads;
    expect(cachedNavigationCounts(repo).nextUp).toBeNull();
    expect(sheet.reads).toBe(before);
  });

  it('refuses counts derived from an older snapshot after a concurrent refresh', async () => {
    const { repo, sheet } = setup(0);
    await loadBoard(repo);
    const old = repo.navigationSnapshots();
    sheet.externalEdit(SHEET_TABS.library.name, 2, 0, 'SYN-CHANGED');
    await repo.listLibrary();
    rememberNavigationCount(repo, 'fixIssues', 99, old);
    expect(cachedNavigationCounts(repo).fixIssues).toBeNull();
  });

  it('keeps counts through identical existing thumbnail/prefetch reads without extending their expiry', async () => {
    const { repo, sheet } = setup(0);
    const board = await loadBoard(repo);
    const expiry = cachedNavigationCounts(repo).expiresAt;
    await repo.getLibrary('SYN-L012');
    await repo.listSchedule();
    const reads = sheet.reads;
    expect(cachedNavigationCounts(repo).nextUp).toBe(nextUpCount(board));
    expect(cachedNavigationCounts(repo).expiresAt).toBe(expiry);
    expect(sheet.reads).toBe(reads);
    vi.spyOn(Date, 'now').mockReturnValue(expiry + 1);
    expect(cachedNavigationCounts(repo).nextUp).toBeNull();
  });

  it('hides a pending refresh and a changed snapshot without reading any provider itself', async () => {
    const { repo, sheet } = setup(0);
    const board = await loadBoard(repo);
    const read = sheet.readTab.bind(sheet);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(sheet, 'readTab').mockImplementationOnce(async (...args) => {
      const rows = await read(...args);
      await pending;
      return rows;
    });
    const refresh = repo.listLibrary();
    const reads = sheet.reads;
    expect(cachedNavigationCounts(repo).nextUp).toBeNull();
    expect(sheet.reads).toBe(reads);
    release();
    await refresh;
    expect(cachedNavigationCounts(repo).nextUp).toBe(nextUpCount(board));
    sheet.externalEdit(SHEET_TABS.library.name, 2, 0, 'SYN-CHANGED');
    await repo.listLibrary();
    expect(cachedNavigationCounts(repo).nextUp).toBeNull();
  });
});
