import 'server-only';
import type { LibraryField, ScheduleField } from '@/domain/sheet-schema';

export type ContentCollection = 'library' | 'queue';
type Snake<S extends string> = S extends `${infer A}${infer B}`
  ? `${A extends Lowercase<A> ? A : `_${Lowercase<A>}`}${Snake<B>}` : S;
type NumericField = 'hookScore' | 'contentAngle' | 'views' | 'likes' | 'reposts' | 'replies' | 'bookmarks' | 'newFollowers';
type NullableTextField = 'parentContentId' | 'finalSyncedAt' | 'publishedAt' | 'analyticsSyncedAt';
// SQL numeric drivers may return text; validateContentRow normalizes Hook Score.
type Columns<F extends string> = { [K in F as Snake<K>]: K extends 'posted' | 'queueForSchedule' ? boolean
  : K extends 'hookScore' ? number | string | null
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

export type ContentTarget = ContentCollection | 'schedule';
export type ContentWrite = {
  operationId: string; patchHash: string; actorHash: string; kind: ContentTarget; id: string;
  expectedVersion: string | null; data: Record<string, unknown>;
};
export type ContentWriteResult = {
  ok: boolean; code: 'CONFLICT' | 'STALE_READ' | 'NOT_FOUND' | null;
  steps: { state: 'applied' | 'already_applied' | 'stale' | 'not_found' | 'conflict'; reason?: string }[];
  revision: number | string | null; replayed?: boolean;
};

export interface ContentDb {
  readonly mode: 'fake' | 'live';
  schemaVersion(): Promise<unknown>;
  /** Visible only after the atomic import commits; null before the first import. */
  latestImportId(): Promise<string | null>;
  listPosts(collection: ContentCollection | 'ready'): Promise<ContentPostRow[]>;
  getPost(collection: ContentCollection, id: string): Promise<ContentPostRow | null>;
  listSchedule(): Promise<ContentScheduleRow[]>;
  getSchedule(id: string): Promise<ContentScheduleRow | null>;
  queueSummary(): Promise<ContentSummaryRow[]>;
  workflowSettings(): Promise<ContentSettingRow[]>;
  writeThrough(write: ContentWrite): Promise<ContentWriteResult>;
  applyPatch(write: ContentWrite): Promise<ContentWriteResult>;
  insertQueueIdea(write: ContentWrite): Promise<ContentWriteResult>;
  /** Exact successful revision, recovered from before-images on durable replay. */
  mutationRow(kind: ContentTarget, id: string, version: string): Promise<ContentPostRow | ContentScheduleRow>;
}
