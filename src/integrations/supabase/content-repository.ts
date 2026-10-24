import 'server-only';
import { z } from 'zod';
import type { ContentDb, ContentPostRow, ContentScheduleRow } from '@/application/content-db';
import type { ContentRepository, QueueIdeaCreate } from '@/application/ports';
import { AppError } from '@/domain/errors';
import { fingerprintValues } from '@/domain/hash';
import { cellText, toLibraryItem, toScheduledPost, type LibraryPatch, type SchedulePatch } from '@/domain/mapping';
import type { MutationEnvelope, MutationResult } from '@/domain/mutation';
import type { LibraryRecord, ScheduleRecord } from '@/domain/records';
import { LIBRARY_HEADERS, SCHEDULE_HEADERS } from '@/domain/sheet-schema';
import { parseWorkflowSettings } from '@/domain/settings';
import { assertContentSchemaVersion } from './content-schema';
import { validateContentRow } from './content-row-schema';

export const contentColumn = (field: string): string => field.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
const summarySchema = z.array(z.object({ content_source: z.string(), master_link: z.string(), counts: z.record(z.string(), z.number().finite().nullable()) }));
const settingsSchema = z.array(z.object({ setting: z.string(), value: z.string(), notes: z.string() }));
function validated<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new AppError('SCHEMA_DRIFT', { kind: 'row' });
  return parsed.data;
}

// PostgREST emits timestamptz in UTC. Sheet's operational display is Taipei.
function taipeiStamp(value: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new AppError('SCHEMA_DRIFT', { kind: 'timestamp' });
  return new Date(date.getTime() + 8 * 60 * 60_000).toISOString().replace(/\.000Z$/, '+08:00').replace(/Z$/, '+08:00');
}

function cells<F extends string>(headers: Record<F, string>, row: object): Record<F, string> {
  const raw = row as Record<string, unknown>;
  return Object.fromEntries(Object.keys(headers).map(field => {
    let value = cellText(raw[contentColumn(field)]);
    if (['finalSyncedAt', 'publishedAt', 'analyticsSyncedAt'].includes(field)) value = taipeiStamp(value);
    if (field === 'finalSyncedAt' && value && raw.final_synced_hash) value += ` #${raw.final_synced_hash}`;
    return [field, value];
  })) as Record<F, string>;
}

export class SupabaseContentRepository implements ContentRepository {
  constructor(private readonly db: ContentDb, private readonly revisionMode: 'db' | 'db-read' = 'db') {}
  capability() { return { provider: 'db', state: 'read_only', mode: this.db.mode } as const; }
  async schema() {
    assertContentSchemaVersion(await this.db.schemaVersion());
    return { ok: true, tabs: [] };
  }
  private async checked<T>(read: () => Promise<T>): Promise<T> { await this.schema(); return read(); }
  private revision(row: ContentPostRow | ContentScheduleRow, table: string, id: string) {
    if (this.revisionMode === 'db-read') {
      if (!row.sheet_revision || !/^[0-9a-f]{16}$/.test(row.sheet_revision)) throw new AppError('SCHEMA_DRIFT', { kind: 'sheet_revision' });
      return row.sheet_revision;
    }
    if (!/^[1-9]\d*$/.test(String(row.row_version))) throw new AppError('SCHEMA_DRIFT', { kind: 'row_version' });
    return fingerprintValues(['db', table, id, String(row.row_version)]);
  }
  private post(row: ContentPostRow): LibraryRecord {
    row = validateContentRow(row);
    const c = cells(LIBRARY_HEADERS, row);
    return { value: toLibraryItem(c), cells: c, row: row.source_sheet_row ?? 0,
      revision: this.revision(row, 'content_studio_posts', `${row.collection}:${c.libraryId}`), formulaFields: [], passthrough: row.passthrough,
      links: { ...(row.source_markdown_url ? { sourceMarkdown: row.source_markdown_url } : {}),
        ...(row.source_master_file_url ? { sourceMasterFile: row.source_master_file_url } : {}),
        ...(row.image_file_url ? { imageFile: row.image_file_url } : {}) } };
  }
  private schedule(row: ContentScheduleRow): ScheduleRecord {
    row = validateContentRow(row);
    const c = cells(SCHEDULE_HEADERS, row);
    return { value: toScheduledPost(c), cells: c, row: row.source_sheet_row ?? 0,
      revision: this.revision(row, 'content_studio_schedule', c.contentId), formulaFields: [], passthrough: row.passthrough,
      links: { ...(row.source_link_url ? { sourceLink: row.source_link_url } : {}), ...(row.image_file_url ? { imageFile: row.image_file_url } : {}) } };
  }
  listLibrary() { return this.listPosts('library'); }
  listQueue() { return this.listPosts('queue'); }
  listReadyQueue() { return this.listPosts('ready'); }
  private listPosts(collection: 'library' | 'queue' | 'ready') { return this.checked(async () => (await this.db.listPosts(collection)).map(row => this.post(row))); }
  getLibrary(id: string) { return this.getPost('library', id); }
  getQueue(id: string) { return this.getPost('queue', id); }
  private getPost(collection: 'library' | 'queue', id: string) {
    return this.checked(async () => { const row = await this.db.getPost(collection, id); if (!row) throw new AppError('NOT_FOUND'); return this.post(row); });
  }
  listSchedule() { return this.checked(async () => (await this.db.listSchedule()).map(row => this.schedule(row))); }
  getSchedule(id: string) { return this.checked(async () => { const row = await this.db.getSchedule(id); if (!row) throw new AppError('NOT_FOUND'); return this.schedule(row); }); }
  queueSummary() { return this.checked(async () => validated(summarySchema, await this.db.queueSummary()).map(row => ({ source: row.content_source, counts: row.counts, masterLink: row.master_link }))); }
  workflowSettings() { return this.checked(async () => parseWorkflowSettings([['Setting', 'Value', 'Notes'], ...validated(settingsSchema, await this.db.workflowSettings()).map(r => [r.setting, r.value, r.notes])])); }
  private disabled<T>(m: { operationId: string }): Promise<MutationResult<T>> { return Promise.resolve({ ok: false, operationId: m.operationId, code: 'FORBIDDEN', steps: [], details: { reason: 'read_only' } }); }
  updateLibrary(m: MutationEnvelope<{ libraryId: string }, LibraryPatch>) { return this.disabled<LibraryRecord>(m); }
  updateQueue(m: MutationEnvelope<{ libraryId: string }, LibraryPatch>) { return this.disabled<LibraryRecord>(m); }
  updateSchedule(m: MutationEnvelope<{ contentId: string }, SchedulePatch>) { return this.disabled<ScheduleRecord>(m); }
  createQueueIdea(m: QueueIdeaCreate) { return this.disabled<LibraryRecord>(m); }
}
