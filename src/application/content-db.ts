import 'server-only';
import type { LibraryField, ScheduleField } from '@/domain/sheet-schema';

export type ContentCollection = 'library' | 'queue';
type Snake<S extends string> = S extends `${infer A}${infer B}`
  ? `${A extends Lowercase<A> ? A : `_${Lowercase<A>}`}${Snake<B>}` : S;
type NumericField = 'hookScore' | 'contentAngle' | 'views' | 'likes' | 'reposts' | 'replies' | 'bookmarks' | 'newFollowers';
type NullableTextField = 'parentContentId' | 'finalSyncedAt' | 'publishedAt' | 'analyticsSyncedAt';
type Columns<F extends string> = { [K in F as Snake<K>]: K extends 'posted' | 'queueForSchedule' ? boolean
  : K extends NumericField ? number | null : K extends NullableTextField ? string | null : string };
export type ContentRowMeta = {
  row_version: number | string;
  source_sheet_row: number | null;
  sheet_revision: string | null;
  passthrough: Record<string, unknown>;
};
export type ContentPostRow = Columns<LibraryField> & ContentRowMeta & {
  collection: ContentCollection;
  source_markdown_url: string;
  source_master_file_url: string;
  image_file_url: string;
};
export type ContentScheduleRow = Columns<ScheduleField> & ContentRowMeta & {
  final_synced_hash: string;
  source_link_url: string;
  image_file_url: string;
};
export type ContentSummaryRow = {
  content_source: string;
  master_link: string;
  count: number;
  counts: Record<string, number | null>;
};
export type ContentSettingRow = { setting: string; value: string; notes: string; source_sheet_row: number | null; row_version?: number | string };

/** Read-only DB-2 boundary. Mutation/RPC methods are introduced by DB-3. */
export interface ContentDb {
  readonly mode: 'fake' | 'live';
  schemaVersion(): Promise<unknown>;
  listPosts(collection: ContentCollection | 'ready'): Promise<ContentPostRow[]>;
  getPost(collection: ContentCollection, id: string): Promise<ContentPostRow | null>;
  listSchedule(): Promise<ContentScheduleRow[]>;
  getSchedule(id: string): Promise<ContentScheduleRow | null>;
  queueSummary(): Promise<ContentSummaryRow[]>;
  workflowSettings(): Promise<ContentSettingRow[]>;
}
