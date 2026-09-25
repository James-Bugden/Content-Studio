import 'server-only';
import { AppError } from '@/domain/errors';
import type { Capability } from '@/domain/capability';
import type { LibraryPatch, SchedulePatch } from '@/domain/mapping';
import type { MutationEnvelope, MutationResult } from '@/domain/mutation';
import type { LibraryRecord, QueueSummaryRow, ScheduleRecord, WorkflowSettings } from '@/domain/records';
import type { ContentRepository, QueueIdeaCreate, SchemaStatus } from '@/application/ports';
import type { MirrorCollection, MirrorRow } from '@/application/sheet-mirror';

type Decoder<T> = (value: unknown) => T;

function object(value: unknown, reason: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('PROVIDER_UNAVAILABLE', { provider: 'supabase', reason });
  return value as Record<string, unknown>;
}

function text(value: unknown, reason: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new AppError('PROVIDER_UNAVAILABLE', { provider: 'supabase', reason });
  return value;
}

function sheetRecord<T extends { libraryId?: string; contentId?: string }>(value: unknown, reason: string): T & LibraryRecord {
  const record = object(value, reason);
  const payload = object(record.value, reason);
  if (!Number.isInteger(record.row) || Number(record.row) < 1 || typeof record.revision !== 'string' || !record.cells || !record.links || !Array.isArray(record.formulaFields)) {
    throw new AppError('PROVIDER_UNAVAILABLE', { provider: 'supabase', reason });
  }
  if (!payload.libraryId && !payload.contentId) throw new AppError('PROVIDER_UNAVAILABLE', { provider: 'supabase', reason });
  return value as T & LibraryRecord;
}

/**
 * A read-only ContentRepository over one complete active Sheet snapshot.
 * It never receives a service key and cannot write either Supabase or Sheets.
 */
export class SnapshotContentRepository implements ContentRepository {
  private readonly byCollection = new Map<MirrorCollection, MirrorRow[]>();

  constructor(rows: MirrorRow[]) {
    for (const row of rows) {
      if (!Number.isInteger(row.position) || row.position < 0) {
        throw new AppError('PROVIDER_UNAVAILABLE', { provider: 'supabase', reason: 'invalid_position', collection: row.collection });
      }
      const collection = this.byCollection.get(row.collection) ?? [];
      if (collection.some((item) => item.stableId === row.stableId)) {
        throw new AppError('PROVIDER_UNAVAILABLE', { provider: 'supabase', reason: 'duplicate_active_row', collection: row.collection });
      }
      if (collection.some((item) => item.position === row.position)) {
        throw new AppError('PROVIDER_UNAVAILABLE', { provider: 'supabase', reason: 'duplicate_position', collection: row.collection });
      }
      collection.push(row);
      collection.sort((a, b) => a.position - b.position);
      this.byCollection.set(row.collection, collection);
    }
  }

  capability(): Capability {
    return { provider: 'sheet', mode: 'live', state: 'read_only', detail: 'Supabase Sheet snapshot' };
  }

  private rows<T>(collection: MirrorCollection, decode: Decoder<T>): T[] {
    return (this.byCollection.get(collection) ?? []).map((item) => decode(item.payload));
  }

  private singleton<T>(collection: MirrorCollection, stableId: string, decode: Decoder<T>): T {
    const matches = (this.byCollection.get(collection) ?? []).filter((item) => item.stableId === stableId);
    if (matches.length !== 1) {
      throw new AppError('PROVIDER_UNAVAILABLE', { provider: 'supabase', reason: matches.length ? 'duplicate_active_row' : 'incomplete_snapshot', collection });
    }
    return decode(matches[0]!.payload);
  }

  private find<T>(collection: MirrorCollection, stableId: string, decode: Decoder<T>): T {
    const matches = (this.byCollection.get(collection) ?? []).filter((item) => item.stableId === stableId);
    if (matches.length === 0) throw new AppError('NOT_FOUND');
    if (matches.length > 1) throw new AppError('AMBIGUOUS_MATCH');
    return decode(matches[0]!.payload);
  }

  async schema(): Promise<SchemaStatus> {
    return this.singleton('schema', 'sheet', (value) => object(value, 'invalid_schema_payload') as SchemaStatus);
  }

  async listLibrary(): Promise<LibraryRecord[]> {
    return this.rows('library', (value) => sheetRecord(value, 'invalid_library_payload') as LibraryRecord);
  }

  async getLibrary(libraryId: string): Promise<LibraryRecord> {
    return this.find('library', libraryId, (value) => sheetRecord(value, 'invalid_library_payload') as LibraryRecord);
  }

  async listQueue(): Promise<LibraryRecord[]> {
    return this.rows('queue', (value) => sheetRecord(value, 'invalid_queue_payload') as LibraryRecord);
  }

  async getQueue(libraryId: string): Promise<LibraryRecord> {
    return this.find('queue', libraryId, (value) => sheetRecord(value, 'invalid_queue_payload') as LibraryRecord);
  }

  async listReadyQueue(): Promise<LibraryRecord[]> {
    return this.rows('ready', (value) => sheetRecord(value, 'invalid_ready_payload') as LibraryRecord);
  }

  async listSchedule(): Promise<ScheduleRecord[]> {
    return this.rows('schedule', (value) => sheetRecord(value, 'invalid_schedule_payload') as unknown as ScheduleRecord);
  }

  async getSchedule(contentId: string): Promise<ScheduleRecord> {
    return this.find('schedule', contentId, (value) => sheetRecord(value, 'invalid_schedule_payload') as unknown as ScheduleRecord);
  }

  async queueSummary(): Promise<QueueSummaryRow[]> {
    return this.rows('queue_summary', (value) => {
      const row = object(value, 'invalid_queue_summary_payload');
      text(row.source, 'invalid_queue_summary_payload');
      object(row.counts, 'invalid_queue_summary_payload');
      return value as QueueSummaryRow;
    });
  }

  async workflowSettings(): Promise<WorkflowSettings> {
    return this.singleton('workflow_settings', 'workflow', (value) => {
      const settings = object(value, 'invalid_workflow_settings_payload');
      text(settings.timezone, 'invalid_workflow_settings_payload');
      if (!Array.isArray(settings.slots) || !Array.isArray(settings.problems)) throw new AppError('PROVIDER_UNAVAILABLE', { provider: 'supabase', reason: 'invalid_workflow_settings_payload' });
      return value as WorkflowSettings;
    });
  }

  private readonlyWrite<T>(operationId: string): Promise<MutationResult<T>> {
    return Promise.resolve({
      ok: false,
      operationId,
      code: 'CONFIG_MISSING',
      details: { reason: 'supabase_read_model' },
      steps: [{ step: 'write Sheet row', provider: 'sheet', status: 'failed', errorCode: 'CONFIG_MISSING' }],
    });
  }

  updateLibrary(m: MutationEnvelope<{ libraryId: string }, LibraryPatch>): Promise<MutationResult<LibraryRecord>> {
    return this.readonlyWrite(m.operationId);
  }

  updateQueue(m: MutationEnvelope<{ libraryId: string }, LibraryPatch>): Promise<MutationResult<LibraryRecord>> {
    return this.readonlyWrite(m.operationId);
  }

  createQueueIdea(m: QueueIdeaCreate): Promise<MutationResult<LibraryRecord>> {
    return this.readonlyWrite(m.operationId);
  }

  updateSchedule(m: MutationEnvelope<{ contentId: string }, SchedulePatch>): Promise<MutationResult<ScheduleRecord>> {
    return this.readonlyWrite(m.operationId);
  }
}
