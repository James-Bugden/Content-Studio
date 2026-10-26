import type { LibraryRecord, ScheduleRecord } from '@/domain/records';
import { FakeSheetTransport } from '@/integrations/google/fake-sheet';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';

export const contentLists = [
  ['library', 'listLibrary'], ['queue', 'listQueue'], ['ready', 'listReadyQueue'], ['schedule', 'listSchedule'],
] as const;
export const skippedCounts = { library: 2, queue: 3, ready: 4, schedule: 5 };

function insertIdless<T extends LibraryRecord | ScheduleRecord>(records: T[], count: number): T[] {
  const idless = Array.from({ length: count }, (_, i) => {
    const record = structuredClone(records[0]!);
    // Set adapter values directly so whitespace exercises the shared trim guard.
    const id = i === 0 ? '' : ' \t\n ';
    if ('libraryId' in record.value) record.value.libraryId = id;
    else record.value.contentId = id;
    if ('libraryId' in record.cells) record.cells.libraryId = id;
    else record.cells.contentId = id;
    return record;
  });
  return [idless[0]!, records[0]!, ...idless.slice(1), ...records.slice(1)];
}

/** A fake repository with mixed valid, empty-ID and whitespace-ID rows. */
export async function sheetWithIdlessRecords() {
  const repo = new SheetsContentRepository(new FakeSheetTransport());
  const library = insertIdless(await repo.listLibrary(), skippedCounts.library);
  const queue = insertIdless(await repo.listQueue(), skippedCounts.queue);
  const ready = insertIdless(await repo.listReadyQueue(), skippedCounts.ready);
  const schedule = insertIdless(await repo.listSchedule(), skippedCounts.schedule);
  return Object.assign(repo, {
    listLibrary: async () => library, listQueue: async () => queue,
    listReadyQueue: async () => ready, listSchedule: async () => schedule,
  });
}
