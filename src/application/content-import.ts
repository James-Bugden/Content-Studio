import 'server-only';
import type { ContentDb } from './content-db';
import type { ContentRepository } from './ports';
import { buildSheetMirrorSnapshot, mirrorHash, type SheetMirrorSnapshot } from './sheet-mirror';
import { AppError } from '@/domain/errors';
import { parseBoolean } from '@/domain/enums';
import type { LibraryRecord, ScheduleRecord, WorkflowSettings } from '@/domain/records';
import { assertContentSchemaVersion } from '@/integrations/supabase/content-schema';

export const IMPORT_COLLECTIONS = ['library', 'queue', 'schedule', 'workflow_settings'] as const;
export type ImportCollection = typeof IMPORT_COLLECTIONS[number];
export type ExceptionClass = 'formula_display' | 'number_formatting' | 'trailing_whitespace';
export type ImportException = { class: ExceptionClass; collection: ImportCollection; field: string; hash: string };
export type ImportRow = { target_kind: ImportCollection; target_id: string; expected_version: number | string | null; row: Record<string, unknown> };
export type ImportEnvelope = {
  operationId: string; actorHash: string; snapshotHash: string;
  counts: Record<ImportCollection, number>; hashes: Record<ImportCollection, string>; exceptions: ImportException[]; rows: ImportRow[];
};
export interface ContentImportStore {
  readonly db: ContentDb;
  applyImport(envelope: ImportEnvelope): Promise<void>;
}
export const importColumn = (field: string) => field.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
const numeric = new Set(['hookScore', 'contentAngle', 'views', 'likes', 'reposts', 'replies', 'bookmarks', 'newFollowers']);
const stamps = new Set(['finalSyncedAt', 'publishedAt', 'analyticsSyncedAt']);
const blocked = () => new AppError('VALIDATION_FAILED', { reason: 'unclassified_import_difference' });

/** Narrow equivalences only: a formula marker alone never excuses lost text. */
export function classifyDifference(expected: unknown, actual: unknown, formula = false): ExceptionClass | null {
  if (typeof expected !== 'string' || typeof actual !== 'string') return null;
  if (expected !== actual && expected.trimEnd() === actual.trimEnd()) return 'trailing_whitespace';
  if (/^-?\d{1,3}(,\d{3})+$/.test(expected) && expected.replace(/,/g, '') === actual) return 'number_formatting';
  if (formula && expected === actual) return 'formula_display';
  return null;
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
    exceptions.push({ class: kind, collection, field, hash: mirrorHash({ collection, field, id, value }) });
  };
  for (const source of snapshot.rows) {
    if (source.collection === 'workflow_settings') {
      const settings = source.payload as WorkflowSettings;
      if (!settings.sourceRows) throw blocked();
      for (const original of settings.sourceRows) {
        const setting = original.setting.trim();
        if (!setting) throw blocked();
        rows.push({ target_kind: 'workflow_settings', target_id: setting,
          expected_version: versions.get(`workflow_settings\0${setting}`) ?? null,
          row: { value: original.value, notes: original.notes, source_sheet_row: original.row } });
      }
      continue;
    }
    if (!['library', 'queue', 'schedule'].includes(source.collection)) continue;
    const collection = source.collection as ImportCollection;
    const record = source.payload as LibraryRecord | ScheduleRecord;
    const row: Record<string, unknown> = { source_sheet_row: record.row, sheet_revision: record.revision, passthrough: record.passthrough ?? {} };
    for (const [field, text] of Object.entries(record.cells)) {
      if ((field === 'contentId' || field === 'libraryId') && text !== source.stableId) throw blocked();
      const column = importColumn(field);
      if (field === 'contentId' || field === 'libraryId') continue;
      let value: unknown = text;
      if (numeric.has(field)) {
        if (text.trim() === '') value = null;
        else {
          if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(text.trim())) throw blocked();
          value = Number(text.trim().replace(/,/g, ''));
          if (!Number.isSafeInteger(value) || Number(value) < -2147483648 || Number(value) > 2147483647) throw blocked();
          const kind = classifyDifference(text.trim(), String(value));
          if (kind) exception(collection, column, source.stableId, kind, text);
        }
      } else if (field === 'posted' || field === 'queueForSchedule') {
        value = parseBoolean(text);
        if (value === null) throw blocked();
      } else if (stamps.has(field)) {
        const [stamp, hash = ''] = field === 'finalSyncedAt' ? text.split(' #') : [text];
        if (stamp && (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d\d:\d\d)$/.test(stamp) || !Number.isFinite(Date.parse(stamp)))) throw blocked();
        value = stamp || null;
        if (field === 'finalSyncedAt') row.final_synced_hash = hash;
      } else if (field === 'parentContentId') value = text || null;
      row[column] = value;
      if (record.formulaFields.includes(field as never)) exception(collection, column, source.stableId, 'formula_display', text);
    }
    for (const [field, column] of Object.entries(collection === 'schedule'
      ? { sourceLink: 'source_link_url', imageFile: 'image_file_url' }
      : { sourceMarkdown: 'source_markdown_url', sourceMasterFile: 'source_master_file_url', imageFile: 'image_file_url' })) {
      row[column] = (record.links as Record<string, string>)[field] ?? '';
    }
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
  const versions = await importVersions(store.db);
  const snapshot = await buildSheetMirrorSnapshot(repo, { sourceKey });
  const envelope = buildTypedImport(snapshot, versions, actorHash);
  await store.applyImport(envelope);
  return { counts: envelope.counts, hashes: envelope.hashes, exceptions: envelope.exceptions, snapshotHash: envelope.snapshotHash };
}
