import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ContentDb, ContentPostRow, ContentScheduleRow, ContentTarget, ContentWrite } from '@/application/content-db';
import type { ContentRepository, QueueIdeaCreate } from '@/application/ports';
import { AppError, isAppError } from '@/domain/errors';
import { fingerprintValues } from '@/domain/hash';
import { cellText, toLibraryItem, toScheduledPost, type LibraryPatch, type SchedulePatch } from '@/domain/mapping';
import { CONTENT_ANGLE_RAW_KEY, numberedContentAngle } from '@/domain/content-angle';
import { HOOK_SCORE_RAW_KEY, decimalHookScore } from '@/domain/hook-score';
import { libraryIdSchema, operationIdSchema, type MutationEnvelope, type MutationResult } from '@/domain/mutation';
import type { LibraryRecord, ScheduleRecord } from '@/domain/records';
import { LIBRARY_HEADERS, SCHEDULE_HEADERS, LIBRARY_WRITABLE, SCHEDULE_WRITABLE } from '@/domain/sheet-schema';
import { parseWorkflowSettings } from '@/domain/settings';
import { assertContentSchemaVersion } from './content-schema';
import { validateContentRow } from './content-row-schema';
import { postVersionsSchema, type PostProperties, type PostPropertiesPatch } from '@/domain/post-versions';
import { CONTENT_TIMESTAMP_FIELDS, FINAL_SYNCED_AT_RAW_KEY, contentTimestampParts, sameContentTimestamp, taipeiContentTimestamp } from '@/application/content-timestamps';

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
  const stamp = taipeiContentTimestamp(value);
  if (stamp === null) throw new AppError('SCHEMA_DRIFT', { kind: 'timestamp' });
  return stamp;
}

function cells<F extends string>(headers: Record<F, string>, row: object): Record<F, string> {
  const raw = row as Record<string, unknown>;
  return Object.fromEntries(Object.keys(headers).map(field => {
    let value = cellText(raw[contentColumn(field)]);
    if (CONTENT_TIMESTAMP_FIELDS.has(field)) value = taipeiStamp(value);
    if (field === 'finalSyncedAt' && value && raw.final_synced_hash) value += ` #${raw.final_synced_hash}`;
    const originalStamp = (raw.passthrough as Record<string, unknown>)[FINAL_SYNCED_AT_RAW_KEY];
    if (field === 'finalSyncedAt' && typeof originalStamp === 'string'
      && sameContentTimestamp(originalStamp, value, field)) value = originalStamp;
    return [field, value];
  })) as Record<F, string>;
}

export class SupabaseContentRepository implements ContentRepository {
  constructor(private readonly db: ContentDb, private readonly revisionMode: 'db' | 'db-read' = 'db') {}
  capability() { return { provider: 'db', state: this.revisionMode === 'db' ? 'ready' : 'read_only', mode: this.db.mode } as const; }
  async schema() {
    assertContentSchemaVersion(await this.db.schemaVersion());
    return { ok: true, tabs: [] };
  }
  private async checked<T>(read: () => Promise<T>): Promise<T> {
    const [, result] = await Promise.all([this.readSchema(), read()]);
    return result;
  }
  private schemaRead?: { until: number; pending: Promise<unknown> };
  private readSchema() {
    if (this.schemaRead && this.schemaRead.until > Date.now()) return this.schemaRead.pending;
    const entry = { until: Date.now() + 3_000, pending: this.schema() };
    this.schemaRead = entry;
    entry.pending.catch(() => { if (this.schemaRead === entry) this.schemaRead = undefined; });
    return entry.pending;
  }
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
    const { [CONTENT_ANGLE_RAW_KEY]: originalAngle, [HOOK_SCORE_RAW_KEY]: originalScore, [FINAL_SYNCED_AT_RAW_KEY]: _originalStamp, ...passthrough } = row.passthrough;
    if (typeof originalScore === 'string' && decimalHookScore(originalScore) !== null
      && decimalHookScore(originalScore) === row.hook_score) c.hookScore = originalScore;
    // A later DB edit must never export a label for a different angle. The
    // ordinary Sheet mapper still sees the exact original text in both modes.
    if (typeof originalAngle === 'string' && numberedContentAngle(originalAngle) !== null
      && numberedContentAngle(originalAngle) === row.content_angle) c.contentAngle = originalAngle;
    const value = toLibraryItem(c);
    if (row.image_sketch) value.visual.sketch = row.image_sketch;
    return { value, cells: c, row: row.source_sheet_row ?? 0,
      revision: this.revision(row, 'content_studio_posts', `${row.collection}:${c.libraryId}`), formulaFields: [], passthrough,
      links: { ...(row.source_markdown_url ? { sourceMarkdown: row.source_markdown_url } : {}),
        ...(row.source_master_file_url ? { sourceMasterFile: row.source_master_file_url } : {}),
        ...(row.image_file_url ? { imageFile: row.image_file_url } : {}) } };
  }
  private schedule(row: ContentScheduleRow): ScheduleRecord {
    row = validateContentRow(row);
    const c = cells(SCHEDULE_HEADERS, row);
    const { [HOOK_SCORE_RAW_KEY]: originalScore, [FINAL_SYNCED_AT_RAW_KEY]: _originalStamp, ...passthrough } = row.passthrough;
    if (typeof originalScore === 'string' && decimalHookScore(originalScore) !== null
      && decimalHookScore(originalScore) === row.hook_score) c.hookScore = originalScore;
    return { value: toScheduledPost(c), cells: c, row: row.source_sheet_row ?? 0,
      revision: this.revision(row, 'content_studio_schedule', c.contentId), formulaFields: [], passthrough,
      links: { ...(row.source_link_url ? { sourceLink: row.source_link_url } : {}), ...(row.image_file_url ? { imageFile: row.image_file_url } : {}) } };
  }
  listLibrary() { return this.listPosts('library'); }
  listQueue() { return this.listPosts('queue'); }
  listReadyQueue() { return this.listPosts('ready'); }
  private listPosts(collection: 'library' | 'queue' | 'ready') { return this.checked(async () => (await this.db.listPosts(collection)).filter(row => !row.deleted_at).map(row => this.post(row))); }
  getLibrary(id: string) { return this.getPost('library', id); }
  getQueue(id: string) { return this.getPost('queue', id); }
  private getPost(collection: 'library' | 'queue', id: string) {
    return this.checked(async () => { const row = await this.db.getPost(collection, id); if (!row || row.deleted_at) throw new AppError('NOT_FOUND'); return this.post(row); });
  }
  private properties(row: ContentPostRow): PostProperties {
    return { revision: this.post(row).revision, versions: postVersionsSchema.parse(row.platform_versions ?? []), deletedAt: row.deleted_at ?? null };
  }
  async postProperties(id: string): Promise<PostProperties> {
    return this.checked(async () => {
      const row = await this.db.getPost('library', id);
      if (!row) throw new AppError('NOT_FOUND');
      return this.properties(row);
    });
  }
  async updatePostProperties(m: MutationEnvelope<{ libraryId: string }, PostPropertiesPatch>): Promise<MutationResult<PostProperties>> {
    const fail = (code: AppError['code']) => this.fail<PostProperties>(m.operationId, 'save post versions', code);
    if (m.actor.role !== 'owner' || this.revisionMode !== 'db') return fail('FORBIDDEN');
    if (!operationIdSchema.safeParse(m.operationId).success || !libraryIdSchema.safeParse(m.target.libraryId).success) return fail('VALIDATION_FAILED');
    const patch = z.object({ versions: postVersionsSchema.optional(), draft: z.string().max(40_000).optional(), deletedAt: z.string().datetime().nullable().optional(), currentHook: z.string().max(500).optional() }).strict().safeParse(m.patch);
    if (!patch.success || !Object.keys(patch.data).length) return fail('VALIDATION_FAILED');
    try {
      await this.schema();
      const row = await this.db.getPost('library', m.target.libraryId);
      const data = { ...(patch.data.versions !== undefined ? { platform_versions: patch.data.versions } : {}),
        ...(patch.data.draft !== undefined ? { draft_content: patch.data.draft } : {}),
        ...(patch.data.deletedAt !== undefined ? { deleted_at: patch.data.deletedAt } : {}),
        ...(patch.data.currentHook !== undefined ? contentPatch({ currentHook: patch.data.currentHook }) : {}) };
      const result = await this.db.applyPatch({ operationId: m.operationId, actorHash: sha256(m.actor.sub),
        patchHash: sha256(JSON.stringify(['post-properties', m.target.libraryId, data])), kind: 'library', id: m.target.libraryId,
        expectedVersion: row && this.post(row).revision === m.expectedRevision ? String(row.row_version) : null, data });
      if (!result.ok) return fail(result.code ?? 'PROVIDER_UNAVAILABLE');
      const after = await this.db.mutationRow('library', m.target.libraryId, String(result.revision));
      return { ok: true, operationId: m.operationId, replayed: result.replayed === true, value: this.properties(after as ContentPostRow),
        steps: [{ step: 'save post versions', provider: 'db', status: result.steps[0]?.state === 'already_applied' ? 'skipped_already_applied' : 'done' }] };
    } catch (error) { return fail(isAppError(error) ? error.code : 'PROVIDER_UNAVAILABLE'); }
  }
  listSchedule() { return this.checked(async () => (await this.db.listSchedule()).map(row => this.schedule(row))); }
  getSchedule(id: string) { return this.checked(async () => { const row = await this.db.getSchedule(id); if (!row) throw new AppError('NOT_FOUND'); return this.schedule(row); }); }
  queueSummary() { return this.checked(async () => validated(summarySchema, await this.db.queueSummary()).map(row => ({ source: row.content_source, counts: row.counts, masterLink: row.master_link }))); }
  workflowSettings() { return this.checked(async () => parseWorkflowSettings([['Setting', 'Value', 'Notes'], ...validated(settingsSchema, await this.db.workflowSettings()).map(r => [r.setting, r.value, r.notes])])); }
  private fail<R>(operationId: string, step: string, code: AppError['code'], details?: Record<string, unknown>): MutationResult<R> {
    return { ok: false, operationId, code, steps: [{ step, provider: 'db', status: 'failed', errorCode: code }], ...(details ? { details } : {}) };
  }
  private async write<R extends LibraryRecord | ScheduleRecord>(kind: ContentTarget, id: string,
    m: MutationEnvelope<unknown, LibraryPatch | SchedulePatch>, idea = false): Promise<MutationResult<R>> {
    const step = idea ? 'append queue idea' : `write ${kind} row`;
    const fail = (code: AppError['code'], details?: Record<string, unknown>) => this.fail<R>(m.operationId, step, code, details);
    if (m.actor.role !== 'owner') return fail('FORBIDDEN');
    if (!operationIdSchema.safeParse(m.operationId).success) return fail('VALIDATION_FAILED', { reason: 'operation_id' });
    if (this.revisionMode !== 'db') return fail('FORBIDDEN', { reason: 'read_only' });
    const entries = Object.entries(m.patch);
    if (!entries.length) return fail('VALIDATION_FAILED', { reason: 'empty_patch' });
    const writable: readonly string[] = kind === 'schedule' ? SCHEDULE_WRITABLE : LIBRARY_WRITABLE;
    for (const [field, value] of entries) {
      if (!idea && !writable.includes(field) && !(kind === 'library' && field === 'imageSketch')) return fail('VALIDATION_FAILED', { reason: 'field_not_writable', field });
      if (field === 'contentId' && value !== id) return fail('VALIDATION_FAILED', { reason: 'field_not_writable', field });
      if (typeof value !== 'string' || value.length > 50_000) return fail('VALIDATION_FAILED', { reason: 'value_invalid', field });
    }
    let accepted = false;
    try {
      await this.schema();
      // Include raw strings as well as typed values: two distinct exact patches
      // must conflict even when PostgreSQL normalizes them to the same value.
      const patchHash = sha256(JSON.stringify([idea ? 'queue' : 'patch', kind, id, entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)]));
      const row = kind === 'schedule' ? await this.db.getSchedule(id) : await this.db.getPost(kind, id);
      const current = row ? kind === 'schedule' ? this.schedule(row as ContentScheduleRow) : this.post(row as ContentPostRow) : null;
      const data = contentPatch(m.patch, current?.cells);
      const write: ContentWrite = { operationId: m.operationId, patchHash, actorHash: sha256(m.actor.sub), kind, id, data,
        expectedVersion: !idea && current?.revision === m.expectedRevision ? String(row!.row_version) : null };
      const result = await (idea ? this.db.insertQueueIdea(write) : this.db.applyPatch(write));
      const revision = result.revision === null ? undefined : fingerprintValues(['db', kind === 'schedule' ? 'content_studio_schedule' : 'content_studio_posts', kind === 'schedule' ? id : `${kind}:${id}`, String(result.revision)]);
      if (!result.ok) return fail(result.code ?? 'PROVIDER_UNAVAILABLE', result.code === 'STALE_READ'
        ? { currentRevision: revision, expectedRevision: m.expectedRevision }
        : result.code === 'CONFLICT' ? { reason: result.steps[0]?.reason ? idea ? 'operation_reused_with_different_idea' : result.steps[0].reason : 'library_id_already_used' } : undefined);
      accepted = true;
      if (!revision) throw new AppError('SCHEMA_DRIFT');
      const after = await this.db.mutationRow(kind, id, String(result.revision));
      const value = (kind === 'schedule' ? this.schedule(after as ContentScheduleRow) : this.post(after as ContentPostRow)) as R;
      const skipped = result.steps[0]?.state === 'already_applied';
      return { ok: true, operationId: m.operationId, replayed: result.replayed === true || (skipped && (idea || revision !== m.expectedRevision)), value,
        steps: [{ step, provider: 'db', status: skipped ? 'skipped_already_applied' : 'done', revision }] };
    } catch (error) {
      const code = isAppError(error) ? error.code : 'PROVIDER_UNAVAILABLE';
      if (accepted) return { ok: false, operationId: m.operationId, code: 'PARTIAL_FAILURE', steps: [
        { step, provider: 'db', status: 'done' }, { step: 'confirm new revision', provider: 'db', status: 'failed', errorCode: code }], };
      return fail(code, isAppError(error) && code === 'VALIDATION_FAILED' ? error.details : undefined);
    }
  }
  updateLibrary(m: MutationEnvelope<{ libraryId: string }, LibraryPatch>) { return this.write<LibraryRecord>('library', m.target.libraryId, m); }
  updateQueue(m: MutationEnvelope<{ libraryId: string }, LibraryPatch>) { return this.write<LibraryRecord>('queue', m.target.libraryId, m); }
  updateSchedule(m: MutationEnvelope<{ contentId: string }, SchedulePatch>) { return this.write<ScheduleRecord>('schedule', m.target.contentId, m); }
  createQueueIdea(m: QueueIdeaCreate) {
    const fail = (code: AppError['code'], details?: Record<string, unknown>) => Promise.resolve(this.fail<LibraryRecord>(m.operationId, 'append queue idea', code, details));
    if (m.actor.role !== 'owner') return fail('FORBIDDEN');
    if (!operationIdSchema.safeParse(m.operationId).success || !libraryIdSchema.safeParse(m.libraryId).success) return fail('VALIDATION_FAILED', { reason: 'identifier' });
    if (!m.currentHook.trim() || m.currentHook.length > 500 || !m.draftContent.trim() || m.draftContent.length > 50_000) return fail('VALIDATION_FAILED', { reason: 'content' });
    return this.write<LibraryRecord>('queue', m.libraryId, { ...m, expectedRevision: '', target: {}, patch: {
      state: 'Idea', contentSource: 'Social Replies', sourcePlatform: m.sourcePlatform, targetPlatform: m.sourcePlatform,
      slug: `social-reply-${m.libraryId.toLowerCase()}`, workflowRole: 'Backlog idea', pairKey: `social-reply-${m.libraryId.toLowerCase()}`,
      reviewStatus: 'Not Reviewed', queueForSchedule: 'FALSE', nextAction: 'Promote to Editing', currentHook: m.currentHook, draftContent: m.draftContent,
    } }, true);
  }
}

export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
const numericFields = new Set(['hookScore', 'contentAngle', 'views', 'likes', 'reposts', 'replies', 'bookmarks', 'newFollowers']);
/** Domain cells remain strings; only the storage boundary normalizes SQL types. */
export function contentPatch(patch: Record<string, string | undefined>, currentCells?: Partial<Record<string, string>>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(patch)) {
    if (value === undefined) throw new AppError('VALIDATION_FAILED', { reason: 'value_invalid', field });
    let typed: unknown = value;
    if (field === 'queueForSchedule' || field === 'posted') typed = value === 'TRUE';
    if (field === 'hookScore') {
      typed = value === '' ? null : decimalHookScore(value);
      if (typed === null && value !== '') throw new AppError('VALIDATION_FAILED', { reason: 'value_invalid', field });
    } else if (numericFields.has(field)) {
      typed = value === '' ? null : Number(value.replace(/,/g, ''));
      if (typed !== null && (!Number.isInteger(typed) || Number(typed) < -2147483648 || Number(typed) > 2147483647 || (['views', 'likes', 'reposts', 'replies', 'bookmarks', 'newFollowers'].includes(field) && Number(typed) < 0))) throw new AppError('VALIDATION_FAILED', { reason: 'value_invalid', field });
    }
    if (CONTENT_TIMESTAMP_FIELDS.has(field)) {
      const parts = contentTimestampParts(value, field);
      // SQL timestamps represent instants. Never interpret an offset-free value
      // in the server's local time zone (which differs between dev and hosting).
      if (!parts) throw new AppError('VALIDATION_FAILED', { reason: 'value_invalid', field });
      const { stamp, hash } = parts;
      typed = stamp ? new Date(stamp).toISOString() : null;
      if (field === 'finalSyncedAt') result.final_synced_hash = hash;
    }
    if (field === 'parentContentId' && value === '') typed = null;
    // A new plain cell value replaces its old hyperlink, including clearing it.
    // Otherwise the asset route could keep serving the previous imported file.
    if (['imageFile', 'sourceLink', 'sourceMarkdown', 'sourceMasterFile'].includes(field) && currentCells?.[field] !== value) {
      result[`${contentColumn(field)}_url`] = /^https?:\/\//i.test(value) ? value : '';
    }
    result[contentColumn(field)] = typed;
  }
  if (Buffer.byteLength(JSON.stringify(result)) > 262_144) throw new AppError('VALIDATION_FAILED', { reason: 'value_size' });
  return result;
}
