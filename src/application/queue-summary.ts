import 'server-only';
import type { LibraryRecord, QueueSummaryRow } from '@/domain/records';
import { parseBoolean } from '@/domain/enums';
import { hasStableSheetId } from './sheet-records';

/** Matches 20261024000200's queue-only SQL view, using raw imported cells. */
export function deriveQueueSummary(queue: readonly LibraryRecord[]): QueueSummaryRow[] {
  const groups = new Map<string, LibraryRecord[]>();
  for (const record of queue.filter(hasStableSheetId)) {
    const source = record.cells.contentSource;
    const rows = groups.get(source) ?? [];
    rows.push(record); groups.set(source, rows);
  }
  // PostgreSQL COLLATE "C" orders UTF-8 bytes, not locale or UTF-16 code units.
  const compare = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b));
  return [...groups].sort(([a], [b]) => compare(a, b)).map(([source, rows]) => {
    const minLink = (field: 'sourceMasterFile' | 'sourceMarkdown') => rows.map(r => r.links[field] ?? '').filter(link => link !== '').sort(compare)[0];
    return { source, masterLink: minLink('sourceMasterFile') ?? minLink('sourceMarkdown') ?? '', counts: {
      Total: rows.length,
      'Not Reviewed': rows.filter(r => ['', 'Not Reviewed', 'Pending'].includes(r.cells.reviewStatus)).length,
      Approved: rows.filter(r => r.cells.reviewStatus === 'Approved').length,
      Queued: rows.filter(r => parseBoolean(r.cells.queueForSchedule) === true).length,
      'Needs Fix': rows.filter(r => r.cells.reviewStatus === 'Changes Requested' || ['CHECK', 'DUPLICATE'].includes(r.cells.duplicateQa)).length,
    } };
  });
}
