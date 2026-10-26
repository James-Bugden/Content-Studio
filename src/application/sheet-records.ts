import 'server-only';
import type { LibraryRecord, ScheduleRecord } from '@/domain/records';

/** Sheet spacers and unfinished rows are not importable or comparable records. */
export function hasStableSheetId(record: LibraryRecord | ScheduleRecord): boolean {
  const id = 'libraryId' in record.value ? record.value.libraryId : record.value.contentId;
  return id.trim() !== '';
}

/** Only the exact empty-view sentinel is a placeholder; similar real rows survive. */
export function isReadyQueuePlaceholder(record: LibraryRecord): boolean {
  return record.cells.libraryId === 'No posts queued'
    && Object.entries(record.cells).every(([field, text]) => field === 'libraryId' || text === '')
    && Object.values(record.links).every(link => !link)
    && Object.values(record.passthrough ?? {}).every(cell => {
      if (!cell || typeof cell !== 'object') return cell === '';
      const extra = cell as Record<string, unknown>;
      return ['value', 'formula', 'link'].every(key => extra[key] === undefined || extra[key] === '');
    });
}
