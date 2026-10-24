import 'server-only';
import { LIBRARY_HEADERS, SCHEDULE_HEADERS } from '@/domain/sheet-schema';

/** Shared RAW serialization for repository updates, idea appends and DB export.
 * Checkbox cells must carry a boolValue, even though domain cells are strings. */
export function sheetCellValue(header: string, value: string): string | boolean {
  return header === LIBRARY_HEADERS.queueForSchedule || header === SCHEDULE_HEADERS.posted ? value === 'TRUE' : value;
}
