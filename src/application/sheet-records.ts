import 'server-only';
import type { LibraryRecord, ScheduleRecord } from '@/domain/records';

/** Sheet spacers and unfinished rows are not importable or comparable records. */
export function hasStableSheetId(record: LibraryRecord | ScheduleRecord): boolean {
  const id = 'libraryId' in record.value ? record.value.libraryId : record.value.contentId;
  return id.trim() !== '';
}
