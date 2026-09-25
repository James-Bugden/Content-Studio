import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { AppError } from '@/domain/errors';
import type { LibraryRecord, QueueSummaryRow, ScheduleRecord, WorkflowSettings } from '@/domain/records';
import type { ContentRepository } from './ports';

export const MIRROR_SCHEMA_VERSION = 1 as const;

export type MirrorCollection = 'schema' | 'library' | 'queue' | 'ready' | 'schedule' | 'queue_summary' | 'workflow_settings';

export type MirrorRow = {
  collection: MirrorCollection;
  stableId: string;
  sourceRow: number | null;
  sourceRevision: string | null;
  rowHash: string;
  payload: unknown;
};

export type SheetMirrorSnapshot = {
  schemaVersion: typeof MIRROR_SCHEMA_VERSION;
  sourceKey: string;
  runId: string;
  startedAt: string;
  counts: Record<MirrorCollection, number>;
  snapshotHash: string;
  rows: MirrorRow[];
};

export type MirrorApplyResult = {
  runId: string;
  snapshotHash: string;
  replayed: boolean;
  upserted: number;
  retired: number;
};

export interface SheetMirrorStore {
  applySnapshot(snapshot: SheetMirrorSnapshot): Promise<MirrorApplyResult>;
  readActive(sourceKey: string): Promise<MirrorRow[]>;
}

const COLLECTIONS: MirrorCollection[] = ['schema', 'library', 'queue', 'ready', 'schedule', 'queue_summary', 'workflow_settings'];
const SOURCE_KEY = /^[a-z0-9][a-z0-9_-]{7,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** JSON with stable object-key order. Arrays retain their source order. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

export function mirrorHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonicalValue(child)]),
    );
  }
  return value;
}

function row(collection: MirrorCollection, stableId: string, payload: unknown, source?: LibraryRecord | ScheduleRecord): MirrorRow {
  const id = stableId.trim();
  if (!id) throw new AppError('VALIDATION_FAILED', { reason: 'mirror_missing_stable_id', collection });
  return {
    collection,
    stableId: id,
    sourceRow: source?.row ?? null,
    sourceRevision: source?.revision ?? null,
    rowHash: mirrorHash(payload),
    payload,
  };
}

function recordRows(collection: 'library' | 'queue' | 'ready', records: LibraryRecord[]): MirrorRow[] {
  return records.map((record) => row(collection, record.value.libraryId, record, record));
}

function scheduleRows(records: ScheduleRecord[]): MirrorRow[] {
  return records.map((record) => row('schedule', record.value.contentId, record, record));
}

function summaryRows(records: QueueSummaryRow[]): MirrorRow[] {
  return records.map((record) => row('queue_summary', record.source, record));
}

function settingsRows(settings: WorkflowSettings): MirrorRow[] {
  return [row('workflow_settings', 'workflow', settings)];
}

function assertUnique(rows: MirrorRow[]): void {
  const seen = new Set<string>();
  for (const item of rows) {
    const key = `${item.collection}\u0000${item.stableId}`;
    if (seen.has(key)) throw new AppError('CONFLICT', { reason: 'mirror_duplicate_stable_id', collection: item.collection });
    seen.add(key);
  }
}

export async function buildSheetMirrorSnapshot(
  repo: ContentRepository,
  options: { sourceKey: string; runId?: string; startedAt?: Date } = { sourceKey: '' },
): Promise<SheetMirrorSnapshot> {
  if (!SOURCE_KEY.test(options.sourceKey)) throw new AppError('VALIDATION_FAILED', { reason: 'mirror_source_key' });
  const runId = options.runId ?? randomUUID();
  if (!UUID.test(runId)) throw new AppError('VALIDATION_FAILED', { reason: 'mirror_run_id' });

  // The snapshot is complete or it is not applied. This prevents a transient
  // provider failure from retiring rows that were merely absent from a partial read.
  const [schema, library, queue, ready, schedule, summary, settings] = await Promise.all([
    repo.schema(),
    repo.listLibrary(),
    repo.listQueue(),
    repo.listReadyQueue(),
    repo.listSchedule(),
    repo.queueSummary(),
    repo.workflowSettings(),
  ]);

  const rows = [
    row('schema', 'sheet', schema),
    ...recordRows('library', library),
    ...recordRows('queue', queue),
    ...recordRows('ready', ready),
    ...scheduleRows(schedule),
    ...summaryRows(summary),
    ...settingsRows(settings),
  ].sort((a, b) => a.collection.localeCompare(b.collection) || a.stableId.localeCompare(b.stableId));
  assertUnique(rows);

  const counts = Object.fromEntries(COLLECTIONS.map((collection) => [collection, rows.filter((item) => item.collection === collection).length])) as Record<
    MirrorCollection,
    number
  >;
  const snapshotHash = mirrorHash(rows.map(({ collection, stableId, rowHash }) => ({ collection, stableId, rowHash })));
  return {
    schemaVersion: MIRROR_SCHEMA_VERSION,
    sourceKey: options.sourceKey,
    runId,
    startedAt: (options.startedAt ?? new Date()).toISOString(),
    counts,
    snapshotHash,
    rows,
  };
}

export async function snapshotSheets(repo: ContentRepository, store: SheetMirrorStore, options: { sourceKey: string; runId?: string; startedAt?: Date }): Promise<MirrorApplyResult> {
  return store.applySnapshot(await buildSheetMirrorSnapshot(repo, options));
}
