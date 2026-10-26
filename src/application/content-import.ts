import 'server-only';
import type { ContentDb } from './content-db';
import type { ContentRepository } from './ports';
import { buildSheetMirrorSnapshot, mirrorHash, evidenceHash, type SheetMirrorSnapshot } from './sheet-mirror';
import { AppError, isAppError } from '@/domain/errors';
import { parseBoolean } from '@/domain/enums';
import { CONTENT_ANGLE_RAW_KEY, numberedContentAngle } from '@/domain/content-angle';
import { HOOK_SCORE_RAW_KEY, decimalHookScore } from '@/domain/hook-score';
import type { LibraryRecord, ScheduleRecord, WorkflowSettings } from '@/domain/records';
import { assertContentSchemaVersion } from '@/integrations/supabase/content-schema';
import { CONTENT_TIMESTAMP_FIELDS, contentTimestampParts, sameContentTimestamp, taipeiContentTimestamp } from './content-timestamps';

export const IMPORT_COLLECTIONS = ['library', 'queue', 'schedule', 'workflow_settings'] as const;
export type ImportCollection = typeof IMPORT_COLLECTIONS[number];
export type CopyRefusal = 'refused_numeric' | 'refused_size';
export type ExceptionClass = 'formula_display' | 'number_formatting' | 'trailing_whitespace' | 'blank_boolean' | 'boolean_formatting' | 'timestamp_formatting' | CopyRefusal;
export type ImportException = { class: ExceptionClass; collection: ImportCollection; field: string; hash: string };
export type ImportRow = { target_kind: ImportCollection; target_id: string; expected_version: number | string | null; row: Record<string, unknown> };
export type ImportEnvelope = {
  operationId: string; actorHash: string; snapshotHash: string;
  counts: Record<ImportCollection, number>; hashes: Record<ImportCollection, string>; exceptions: ImportException[]; rows: ImportRow[];
};
export interface ContentImportStore {
  readonly db: ContentDb;
  applyImport(envelope: ImportEnvelope, leaseToken?: string): Promise<void>;
  claim?(operationId: string, requestHash: string): Promise<{ status: 'acquired' | 'in_progress' | 'replayed'; token: string; result?: unknown }>;
  release?(operationId: string, token: string): Promise<void>;
}
export const importColumn = (field: string) => field.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
const numeric = new Set(['hookScore', 'contentAngle', 'views', 'likes', 'reposts', 'replies', 'bookmarks', 'newFollowers']);
const blocked = () => new AppError('VALIDATION_FAILED', { reason: 'unclassified_import_difference' });
// PostgreSQL's jsonb::text includes spaces after separators. Match that size
// before submitting a batch, so one boundary-size row cannot abort other rows.
function jsonbBytes(value: unknown): number {
  if (Array.isArray(value)) return 2 + value.reduce((n, v) => n + jsonbBytes(v), 0) + Math.max(0, value.length - 1) * 2;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value);
    return 2 + entries.reduce((n, [k, v]) => n + Buffer.byteLength(JSON.stringify(k)) + 2 + jsonbBytes(v), 0) + Math.max(0, entries.length - 1) * 2;
  }
  return Buffer.byteLength(JSON.stringify(value));
}
export function copyRefusal(error: unknown): { class: CopyRefusal; field: string } | null {
  if (!isAppError(error) || error.code !== 'VALIDATION_FAILED') return null;
  if (error.details.reason === 'copy_numeric' && typeof error.details.field === 'string') return { class: 'refused_numeric', field: error.details.field };
  return error.details.reason === 'value_size' ? { class: 'refused_size', field: '@row' } : null;
}

/** Only these representation differences are allowed; copy whitespace is exact. */
export function classifyDifference(expected: unknown, actual: unknown, field = ''): Exclude<ExceptionClass, 'formula_display' | CopyRefusal> | null {
  if (typeof expected !== 'string' || typeof actual !== 'string' || expected === actual) return null;
  if (numeric.has(field) && field !== 'hookScore' && /^ *-?(?:\d+|\d{1,3}(?:,\d{3})+) *$/.test(expected)
    && Number(expected.trim().replace(/,/g, '')) === Number(actual) && /^-?\d+$/.test(actual)) return 'number_formatting';
  if (['posted', 'queueForSchedule'].includes(field) && (actual === 'TRUE' || actual === 'FALSE')
    && parseBoolean(expected) === (actual === 'TRUE')) return expected === '' ? 'blank_boolean' : 'boolean_formatting';
  if (sameContentTimestamp(expected, actual, field)) return 'timestamp_formatting';
  // A single terminal suffix (ASCII spaces, optionally ONE newline), never post copy.
  if (['nextAction', 'imageNextAction', 'hasImage'].includes(field)
    && expected.replace(/ +(?:\r?\n)?$|\r?\n$/, '') === actual && expected !== actual) return 'trailing_whitespace';
  return null;
}

/** Imports repair derived copies only while the Sheet retains authority. */
export function assertImportMode(): void {
  if (process.env.CS_DATA_MODE === 'live' && process.env.CS_CONTENT_STORE !== 'db-shadow'
    && !(process.env.CS_CONTENT_STORE === 'db-read' && process.env.CS_CONTENT_READ_ENABLED === 'true')) throw new AppError('FORBIDDEN', { reason: 'import_store_mode' });
  if (!['db-shadow', 'db-read'].includes(process.env.CS_CONTENT_STORE ?? '')) throw new AppError('FORBIDDEN', { reason: 'import_store_mode' });
}

/** Capture versions BEFORE the Sheet read, including absence. SQL CAS fails closed. */
export async function importVersions(db: ContentDb): Promise<Map<string, number | string>> {
  assertContentSchemaVersion(await db.schemaVersion());
  const [library, queue, schedule, settings] = await Promise.all([db.listPosts('library'), db.listPosts('queue'), db.listSchedule(), db.workflowSettings()]);
  return new Map<string, number | string>([...[...library, ...queue].map(r => [`${r.collection}\0${r.library_id}`, r.row_version] as const),
    ...schedule.map(r => [`schedule\0${r.content_id}`, r.row_version] as const), ...settings.map(r => {
      if (r.row_version === undefined && db.mode !== 'fake') throw blocked();
      return [`workflow_settings\0${r.setting}`, r.row_version ?? 1] as const;
    })]);
}

export function buildTypedImport(snapshot: SheetMirrorSnapshot, versions: Map<string, number | string>, actorHash: string): ImportEnvelope {
  assertImportMode();
  if (!/^[0-9a-f]{64}$/.test(actorHash) || snapshot.rows.some(r => mirrorHash(r.payload) !== r.rowHash)) throw blocked();
  for (const [collection, count] of Object.entries(snapshot.counts)) {
    if (snapshot.rows.filter(r => r.collection === collection).length !== count) throw blocked();
  }
  if (snapshot.schemaVersion !== 1 || snapshot.counts.schema !== 1 || snapshot.counts.workflow_settings !== 1 || ['schema', 'library', 'queue', 'ready', 'schedule', 'queue_summary', 'workflow_settings'].some(c => !(c in snapshot.counts))) throw blocked();
  const schema = snapshot.rows.find(r => r.collection === 'schema')?.payload as { ok?: boolean } | undefined;
  if (schema?.ok !== true) throw new AppError('SCHEMA_DRIFT');
  const exceptions: ImportException[] = [];
  const rows: ImportRow[] = [];
  const exception = (collection: ImportCollection, field: string, id: string, kind: ExceptionClass, value: unknown) => {
    exceptions.push({ class: kind, collection, field, hash: evidenceHash({ collection, field, id, value }) });
  };
  for (const source of snapshot.rows) {
    if (source.collection === 'workflow_settings') {
      const settings = source.payload as WorkflowSettings;
      if (!settings.sourceRows) throw blocked();
      for (const original of settings.sourceRows) {
        const setting = original.setting.trim();
        if (!setting || setting !== original.setting) throw blocked();
        rows.push({ target_kind: 'workflow_settings', target_id: setting,
          expected_version: versions.get(`workflow_settings\0${setting}`) ?? null,
          row: { value: original.value, notes: original.notes, source_sheet_row: original.row } });
      }
      continue;
    }
    if (!['library', 'queue', 'schedule'].includes(source.collection)) continue;
    const collection = source.collection as Exclude<ImportCollection, 'workflow_settings'>;
    const record = source.payload as LibraryRecord | ScheduleRecord;
    // A refused derived row must remain unequal/pending, without stopping other
    // rows in shadow/read modes. Only named refusals qualify; unknown differences still fail closed.
    const rowExceptions: Parameters<typeof exception>[] = [];
    let row: Record<string, unknown>;
    try { row = typedContentRow(collection, source.stableId, record, (...args) => rowExceptions.push(args)); }
    catch (error) {
      const refusal = copyRefusal(error);
      if (!['db-shadow', 'db-read'].includes(process.env.CS_CONTENT_STORE ?? '') || !refusal) throw error;
      exception(collection, refusal.field, source.stableId, refusal.class, record.revision);
      continue;
    }
    for (const args of rowExceptions) exception(...args);
    rows.push({ target_kind: collection, target_id: source.stableId, expected_version: versions.get(`${collection}\0${source.stableId}`) ?? null, row });
  }
  rows.sort((a, b) => `${a.target_kind}\0${a.target_id}` < `${b.target_kind}\0${b.target_id}` ? -1 : 1);
  if (new Set(rows.map(r => `${r.target_kind}\0${r.target_id}`)).size !== rows.length) throw blocked();
  const counts = Object.fromEntries(IMPORT_COLLECTIONS.map(c => [c, rows.filter(r => r.target_kind === c).length])) as ImportEnvelope['counts'];
  const hashes = Object.fromEntries(IMPORT_COLLECTIONS.map(c => [c, mirrorHash(rows.filter(r => r.target_kind === c))])) as ImportEnvelope['hashes'];
  const body = { counts, hashes, exceptions, rows };
  return { operationId: snapshot.runId, actorHash, snapshotHash: mirrorHash(body), ...body };
}

export async function runTypedImport(repo: ContentRepository, store: ContentImportStore, sourceKey: string, actorHash: string) {
  assertImportMode();
  const versions = await importVersions(store.db);
  const snapshot = await buildSheetMirrorSnapshot(repo, { sourceKey });
  const envelope = buildTypedImport(snapshot, versions, actorHash);
  await store.applyImport(envelope);
  return { counts: envelope.counts, hashes: envelope.hashes, exceptions: envelope.exceptions, snapshotHash: envelope.snapshotHash };
}

/** Shared import/write-through conversion: never coerce unclassified Sheet content. */
export function typedContentRow(collection: Exclude<ImportCollection, 'workflow_settings'>, stableId: string, record: LibraryRecord | ScheduleRecord,
  exception: (collection: ImportCollection, field: string, id: string, kind: ExceptionClass, value: unknown) => void = () => {}): Record<string, unknown> {
  const row: Record<string, unknown> = { source_sheet_row: record.row, sheet_revision: record.revision, passthrough: record.passthrough ?? {} };
  for (const [field, text] of Object.entries(record.cells)) {
    if ((field === 'contentId' || field === 'libraryId') && text !== stableId) throw blocked();
    const column = importColumn(field);
    if (field === 'contentId' || field === 'libraryId') continue;
    let value: unknown = text;
    let rendered = text;
    if (numeric.has(field)) {
      const angle = field === 'contentAngle' ? numberedContentAngle(text) : null;
      if (angle !== null) {
        value = angle;
        // Keep the exact Sheet cell, not a formatting exception. Do not mutate
        // the source record or mix metadata into exported unknown columns.
        row.passthrough = { ...(row.passthrough as Record<string, unknown>), [CONTENT_ANGLE_RAW_KEY]: text };
      } else if (text.trim() === '') value = null;
      else if (field === 'hookScore') {
        value = decimalHookScore(text);
        if (value === null) throw new AppError('VALIDATION_FAILED', { reason: 'copy_numeric', field: column });
        row.passthrough = { ...(row.passthrough as Record<string, unknown>), [HOOK_SCORE_RAW_KEY]: text };
      }
      else {
        if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(text.trim())) throw new AppError('VALIDATION_FAILED', { reason: 'copy_numeric', field: column });
        value = Number(text.trim().replace(/,/g, ''));
        if (!Number.isSafeInteger(value) || Number(value) < -2147483648 || Number(value) > 2147483647) throw new AppError('VALIDATION_FAILED', { reason: 'copy_numeric', field: column });
      }
      rendered = angle !== null || field === 'hookScore' && value !== null ? text : value === null ? '' : String(value);
    } else if (field === 'posted' || field === 'queueForSchedule') {
      value = parseBoolean(text);
      if (value === null) throw blocked();
      rendered = value ? 'TRUE' : 'FALSE';
    } else if (CONTENT_TIMESTAMP_FIELDS.has(field)) {
      const parts = contentTimestampParts(text, field);
      if (!parts) throw blocked();
      const { stamp, hash } = parts;
      value = stamp || null;
      rendered = taipeiContentTimestamp(stamp)!;
      if (field === 'finalSyncedAt' && hash) rendered += ` #${hash}`;
      if (field === 'finalSyncedAt') row.final_synced_hash = hash;
    } else if (field === 'parentContentId') value = text || null;
    if (rendered !== text) {
      const kind = classifyDifference(text, rendered, field);
      if (!kind) throw blocked();
      exception(collection, column, stableId, kind, text);
    }
    row[column] = value;
    if (record.formulaFields.includes(field as never)) exception(collection, column, stableId, 'formula_display', text);
  }
  for (const [field, column] of Object.entries(collection === 'schedule'
    ? { sourceLink: 'source_link_url', imageFile: 'image_file_url' }
    : { sourceMarkdown: 'source_markdown_url', sourceMasterFile: 'source_master_file_url', imageFile: 'image_file_url' })) {
    row[column] = (record.links as Record<string, string>)[field] ?? '';
  }
  // Apply the existing DB-3 transport cap to full derived rows too. A Sheet
  // save may be valid while its combined UTF-8 copy exceeds the SQL limit.
  if (jsonbBytes(row) > 262_144) throw new AppError('VALIDATION_FAILED', { reason: 'value_size' });
  return row;
}
