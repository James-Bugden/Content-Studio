import 'server-only';
import { z } from 'zod';
import { LIBRARY_HEADERS, SCHEDULE_HEADERS } from '@/domain/sheet-schema';
import { AppError } from '@/domain/errors';
import { decimalHookScore } from '@/domain/hook-score';
import type { ContentPostRow, ContentScheduleRow } from '@/application/content-db';

const numeric = new Set(['hookScore', 'contentAngle', 'views', 'likes', 'reposts', 'replies', 'bookmarks', 'newFollowers']);
const timestamp = new Set(['finalSyncedAt', 'publishedAt', 'analyticsSyncedAt']);
const column = (field: string) => field.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
function shape(headers: Record<string, string>) {
  return Object.fromEntries(Object.keys(headers).map(field => [column(field),
    field === 'posted' || field === 'queueForSchedule' ? z.boolean()
      : field === 'hookScore' ? z.number().refine(n => decimalHookScore(String(n)) !== null).nullable()
        : numeric.has(field) ? z.number().int().nullable()
        : timestamp.has(field) || field === 'parentContentId' ? z.string().nullable() : z.string()]));
}
const meta = {
  row_version: z.union([z.number().int().positive().max(Number.MAX_SAFE_INTEGER), z.string().regex(/^[1-9]\d*$/)]),
  source_sheet_row: z.number().int().positive().nullable(), sheet_revision: z.string().nullable(),
  passthrough: z.record(z.string(), z.unknown()), image_file_url: z.string(),
};
const post = z.object({ ...shape(LIBRARY_HEADERS), ...meta, collection: z.enum(['library', 'queue']), source_markdown_url: z.string(), source_master_file_url: z.string() }).passthrough();
const schedule = z.object({ ...shape(SCHEDULE_HEADERS), ...meta, final_synced_hash: z.string(), source_link_url: z.string() }).passthrough();

/** Validate persisted rows, including fake rows, before constructing domain values. */
export function validateContentRow(row: ContentPostRow): ContentPostRow;
export function validateContentRow(row: ContentScheduleRow): ContentScheduleRow;
export function validateContentRow(row: ContentPostRow | ContentScheduleRow): ContentPostRow | ContentScheduleRow {
  const parsed = ('collection' in row ? post : schedule).safeParse(row);
  if (!parsed.success) throw new AppError('SCHEMA_DRIFT', { kind: 'row', fields: parsed.error.issues.map(i => String(i.path[0])) });
  return parsed.data as ContentPostRow | ContentScheduleRow;
}
