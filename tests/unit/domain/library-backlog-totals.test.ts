import { describe, expect, it } from 'vitest';
import { libraryBacklogTotals } from '@/domain/library-backlog';
import type { LibraryRecord } from '@/domain/records';
import { FakeSheetTransport } from '@/integrations/google/fake-sheet';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';

/** CS-059: whole-Library totals for the Backlog header. */
const base = async () => (await new SheetsContentRepository(new FakeSheetTransport()).listLibrary())[0]!;
const row = (template: LibraryRecord, id: string, review: string, queued: boolean | null): LibraryRecord => ({
  ...template,
  value: {
    ...template.value,
    libraryId: id,
    reviewStatus: review === '?' ? { ok: false, raw: 'odd' } : { ok: true, value: review },
    queueForSchedule: queued,
  } as LibraryRecord['value'],
});

describe('libraryBacklogTotals', () => {
  it('counts approved posts, and the approved posts that are queued for scheduling', async () => {
    const t = await base();
    const rows = [
      row(t, 'A1', 'Approved', true),
      row(t, 'A2', 'Approved', true),
      row(t, 'A3', 'Approved', false),
      row(t, 'A4', 'Approved', null),
      row(t, 'P1', 'Pending', false),
      row(t, 'S1', 'Skipped', false),
      row(t, 'C1', 'Changes Requested', false),
      row(t, 'X1', '?', false),
    ];
    expect(libraryBacklogTotals(rows)).toEqual({ total: 8, approved: 4, queued: 2 });
  });

  it('a post that is not approved is never counted as queued, even with the queue flag set', async () => {
    const t = await base();
    expect(libraryBacklogTotals([row(t, 'P1', 'Pending', true), row(t, 'C1', 'Changes Requested', true)])).toEqual({ total: 2, approved: 0, queued: 0 });
  });

  it('an empty Library is all zeros', () => {
    expect(libraryBacklogTotals([])).toEqual({ total: 0, approved: 0, queued: 0 });
  });

  it('counts the real synthetic Library consistently (queued never exceeds approved, approved never exceeds total)', async () => {
    const rows = await new SheetsContentRepository(new FakeSheetTransport()).listLibrary();
    const t = libraryBacklogTotals(rows);
    expect(t.total).toBe(rows.length);
    expect(t.queued).toBeLessThanOrEqual(t.approved);
    expect(t.approved).toBeLessThanOrEqual(t.total);
  });
});
