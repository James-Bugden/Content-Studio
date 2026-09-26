import { describe, expect, it } from 'vitest';
import { libraryBacklogStatus, libraryBacklogView } from '@/domain/library-backlog';
import type { LibraryRecord } from '@/domain/records';
import { FakeSheetTransport } from '@/integrations/google/fake-sheet';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';

const records = () => new SheetsContentRepository(new FakeSheetTransport()).listLibrary();

describe('Content Library backlog', () => {
  it('reads the actual Library inventory and filters by source without dropping other rows', async () => {
    const rows = await records();
    const first = rows[0]!;
    const view = libraryBacklogView(rows, { source: first.value.contentSource });
    expect(view.total).toBeGreaterThan(0);
    expect(view.rows.every((r) => r.value.contentSource === first.value.contentSource)).toBe(true);
    expect(view.sources).toContain(first.value.contentSource);
    expect(libraryBacklogView(rows, { source: 'No such source' }).total).toBe(0);
  });

  it('limits rendered rows and clamps a stale page number after filtering', async () => {
    const first = (await records())[0]!;
    const rows = Array.from({ length: 105 }, (_, i) => ({ ...first, row: i + 2, value: { ...first.value, libraryId: `SYNTH-${i}` } })) as LibraryRecord[];
    const page = libraryBacklogView(rows, { page: 2 });
    expect(page.totalPages).toBe(3);
    expect(page.rows).toHaveLength(40);
    expect(page.rows[0]?.row).toBe(42);
    expect(libraryBacklogView(rows, { page: 900 }).page).toBe(3);
  });

  it('does not call a Library row ready for Typefully just because it is approved', async () => {
    const first = (await records())[0]!;
    expect(libraryBacklogStatus({ ...first, value: { ...first.value, reviewStatus: { ok: true, value: 'Approved' }, queueForSchedule: true } })).toBe('Schedule requested');
    expect(libraryBacklogStatus({ ...first, value: { ...first.value, reviewStatus: { ok: true, value: 'Skipped' } } })).toBe('Rejected');
  });

  it('searches current copy without a URL, filters computed status and sorts stably', async () => {
    const [first, second] = await records();
    const rows = [first!, { ...second!, row: 100, value: { ...second!.value, contentSource: 'A source', currentHook: 'Distinctive example hook' } }];
    expect(libraryBacklogView(rows, { search: 'DISTINCTIVE EXAMPLE' }).rows.map((r) => r.row)).toEqual([100]);
    expect(libraryBacklogView(rows, { sort: 'source' }).rows[0]?.row).toBe(100);
    const statuses = new Map([[first!.value.libraryId, { label: 'Ready to schedule' }]]);
    expect(libraryBacklogView(rows, { status: 'Ready to schedule' }, statuses).rows.map((r) => r.row)).toEqual([first!.row]);
    expect(libraryBacklogView(rows, { status: 'Ready to schedule' }, statuses).statusOptions).toContain('Ready to schedule');
  });
});
