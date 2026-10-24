import 'server-only';
import type { ContentCollection, ContentDb, ContentPostRow, ContentScheduleRow, ContentSettingRow, ContentSummaryRow, ContentTarget, ContentWrite, ContentWriteResult } from '@/application/content-db';
import { AppError, type ErrorCode } from '@/domain/errors';
import { syntheticLibraryRows, syntheticQueueRows, syntheticScheduleRows, syntheticSettingsRows } from '@/fixtures/synthetic';
import { discoverHeaders, LIBRARY_HEADERS, SCHEDULE_HEADERS } from '@/domain/sheet-schema';
import { toLibraryRecord, toScheduleRecord } from '@/domain/mapping';
import { contentColumn, sha256 } from './content-repository';
import { CONTENT_STUDIO_SCHEMA_VERSION } from './content-schema';
import type { ContentBackupSnapshot } from '@/application/content-backup';

export type ContentDbSeed = { posts: ContentPostRow[]; schedule: ContentScheduleRow[]; settings: ContentSettingRow[] };
const numeric = new Set(['hookScore', 'contentAngle', 'views', 'likes', 'reposts', 'replies', 'bookmarks', 'newFollowers']);
function typedCells(cells: Record<string, string>) {
  return Object.fromEntries(Object.entries(cells).map(([field, text]) => [contentColumn(field),
    field === 'posted' || field === 'queueForSchedule' ? text === 'TRUE' : numeric.has(field) ? text === '' ? null : Number(text.replace(/,/g, '')) : text]));
}

/** Fixture conversion only, not an importer. DB-4 owns real Sheet import. */
export function syntheticContentDbSeed(): ContentDbSeed {
  const posts = (['library', 'queue'] as const).flatMap(collection => {
    const [header, ...rows] = collection === 'library' ? syntheticLibraryRows() : syntheticQueueRows();
    const found = discoverHeaders(LIBRARY_HEADERS, header!.values);
    if (!found.ok) throw new Error('Invalid synthetic library headers');
    return rows.map((raw, i) => {
      const record = toLibraryRecord(found.index, raw, i + 2);
      return { ...typedCells(record.cells), collection, row_version: 1, source_sheet_row: i + 2,
        sheet_revision: record.revision, passthrough: {}, source_markdown_url: record.links.sourceMarkdown ?? '',
        source_master_file_url: record.links.sourceMasterFile ?? '', image_file_url: record.links.imageFile ?? '' } as ContentPostRow;
    });
  });
  const rows = syntheticScheduleRows();
  const found = discoverHeaders(SCHEDULE_HEADERS, rows[1]!.values);
  if (!found.ok) throw new Error('Invalid synthetic schedule headers');
  const schedule = rows.slice(2).map((raw, i) => {
    const record = toScheduleRecord(found.index, { ...raw, formulas: raw.formulas ?? raw.values }, i + 3);
    const [stamp, hash = ''] = record.cells.finalSyncedAt.split(' #');
    return { ...typedCells(record.cells), final_synced_at: stamp || null, final_synced_hash: hash,
      published_at: record.cells.publishedAt || null, analytics_synced_at: record.cells.analyticsSyncedAt || null,
      parent_content_id: record.cells.parentContentId || null,
      row_version: 1, source_sheet_row: i + 3, sheet_revision: record.revision, passthrough: {},
      source_link_url: record.links.sourceLink ?? '', image_file_url: record.links.imageFile ?? '' } as ContentScheduleRow;
  });
  const settings = syntheticSettingsRows().slice(3).map((raw, i) => ({ setting: String(raw.values[0]), value: String(raw.values[1] ?? ''), notes: String(raw.values[2] ?? ''), source_sheet_row: i + 4 }));
  return { posts, schedule, settings };
}

const textCompare = (a: unknown, b: unknown) => String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
const position = (a: { source_sheet_row: number | null }, b: { source_sheet_row: number | null }) => (a.source_sheet_row ?? Infinity) - (b.source_sheet_row ?? Infinity);

export class FakeContentDb implements ContentDb {
  readonly mode = 'fake' as const;
  private readonly seed: ContentDbSeed;
  constructor(seed: ContentDbSeed = syntheticContentDbSeed(), private readonly version: unknown = CONTENT_STUDIO_SCHEMA_VERSION) { this.seed = structuredClone(seed); }
  private faults: { op: 'read' | 'write'; code: ErrorCode; times: number }[] = [];
  readonly history: { operation_id: string; target_kind: ContentTarget; target_id: string; before_image: ContentPostRow | ContentScheduleRow | null; row_version_before: string | null; changed_fields: string[] }[] = [];
  readonly audit: { operation_id: string; actor_hash: string; target_kind: ContentTarget; target_id: string; changed_fields: string[]; before_hash: string | null; after_hash: string | null; outcome: string }[] = [];
  private readonly operations = new Map<string, { mode: string; write: ContentWrite; result: ContentWriteResult }>();
  failNext(fault: { op: 'read' | 'write'; code: ErrorCode; times?: number }) { this.faults.push({ ...fault, times: fault.times ?? 1 }); }
  private check(op: 'read' | 'write') {
    const fault = this.faults.find(f => f.op === op && f.times > 0);
    if (fault) { fault.times--; throw new AppError(fault.code); }
  }
  externalEdit(kind: ContentTarget, id: string, data: Record<string, unknown>) {
    const row = this.row(kind, id);
    if (!row) throw new AppError('NOT_FOUND');
    this.history.push({ operation_id: 'synthetic-external', target_kind: kind, target_id: id, before_image: structuredClone(row),
      row_version_before: String(row.row_version), changed_fields: Object.keys(data) });
    Object.assign(row, structuredClone(data), { row_version: String(BigInt(row.row_version) + 1n) });
  }
  private row(kind: ContentTarget, id: string) {
    return kind === 'schedule' ? this.seed.schedule.find(r => r.content_id === id) : this.seed.posts.find(r => r.collection === kind && r.library_id === id);
  }
  async mutationRow(kind: ContentTarget, id: string, version: string) {
    this.check('read');
    const current = this.row(kind, id);
    const row = this.history.find(h => h.target_kind === kind && h.target_id === id && h.row_version_before === version)?.before_image
      ?? (current && String(current.row_version) === version ? current : null);
    if (!row) throw new AppError('PROVIDER_UNAVAILABLE', { reason: 'revision_unavailable' });
    return structuredClone(row);
  }
  snapshot(): ContentDbSeed { return structuredClone(this.seed); }
  /** One synchronous snapshot turn, including the durable replay/history data. */
  async backupSnapshot(): Promise<ContentBackupSnapshot> {
    const at = '2026-10-01T00:00:00+00:00';
    const meta = (row: object & { row_version?: string | number }) => ({ created_at: at, updated_at: at, created_by_op: null,
      updated_by_op: null, sheet_revision: null, exported_sheet_revision: null, ...row, row_version: Number(row.row_version ?? 1) });
    return structuredClone({ posts: this.seed.posts.map(meta), schedule: this.seed.schedule.map(meta), workflow_settings: this.seed.settings.map(meta),
      row_history: this.history.map((h, i) => ({ history_id: i + 1, at, ...h, before_image: h.before_image ? meta(h.before_image) : null, row_version_before: h.row_version_before === null ? null : Number(h.row_version_before) })), audit_events: this.audit.map((a, i) => ({ event_id: i + 1, at, ...a })),
      operations: [...this.operations].map(([operation_id, op]) => ({ operation_id, patch_hash: op.write.patchHash, actor_hash: op.write.actorHash,
        target_kind: op.write.kind, target_id: op.write.id, mode: op.mode, result: op.result, created_at: at })) });
  }
  replaceSnapshot(seed: ContentDbSeed) { Object.assign(this.seed, structuredClone(seed)); }
  async writeThrough(write: ContentWrite) { return this.mutate('copy', write); }
  async applyPatch(write: ContentWrite) { return this.mutate('patch', write); }
  async insertQueueIdea(write: ContentWrite) { return this.mutate('queue', write); }
  private mutate(mode: 'patch' | 'queue' | 'copy', write: ContentWrite): ContentWriteResult {
    this.check('write');
    const { operationId, kind, id, data } = write;
    const prior = this.operations.get(operationId);
    if (prior) {
      if (prior.mode !== mode || prior.write.patchHash !== write.patchHash || prior.write.actorHash !== write.actorHash || prior.write.kind !== kind || prior.write.id !== id)
        return { ok: false, code: 'CONFLICT', steps: [{ state: 'conflict', reason: 'operation_reused_with_different_patch' }], revision: null };
      return { ...structuredClone(prior.result), replayed: true };
    }
    let row = this.row(kind, id);
    const before = structuredClone(row ?? null);
    const fields = Object.keys(data).filter(f => !row || JSON.stringify((row as unknown as Record<string, unknown>)[f]) !== JSON.stringify(data[f])).sort();
    let state: ContentWriteResult['steps'][number]['state'];
    let code: ContentWriteResult['code'] = null;
    if (!row && mode === 'patch') { state = 'not_found'; code = 'NOT_FOUND'; }
    else if (row && fields.length === 0) state = 'already_applied';
    else if (row && mode === 'queue') { state = 'conflict'; code = 'CONFLICT'; }
    else if (row && String(row.row_version) !== write.expectedVersion) { state = 'stale'; code = 'STALE_READ'; }
    else {
      if (!row) {
        const headers = kind === 'schedule' ? SCHEDULE_HEADERS : LIBRARY_HEADERS;
        const defaults = Object.fromEntries(Object.keys(headers).map(f => [contentColumn(f), ['queueForSchedule', 'posted'].includes(f) ? false : numeric.has(f) ? null : '']));
        row = { ...defaults, library_id: id, collection: 'queue', row_version: 1, source_sheet_row: null,
          sheet_revision: null, passthrough: {}, source_markdown_url: '', source_master_file_url: '', image_file_url: '', ...structuredClone(data) } as ContentPostRow;
        if (kind === 'schedule') {
          row = { ...row, content_id: id, parent_content_id: null, final_synced_at: null, published_at: null, analytics_synced_at: null, final_synced_hash: '', source_link_url: '', ...structuredClone(data) } as unknown as ContentScheduleRow;
          this.seed.schedule.push(row);
        } else { row.collection = kind; this.seed.posts.push(row); }
      } else Object.assign(row, structuredClone(data), { row_version: String(BigInt(row.row_version) + BigInt(mode !== 'copy' || fields.some(f => !['source_sheet_row', 'sheet_revision'].includes(f)))) });
      state = 'applied';
      this.history.push({ operation_id: operationId, target_kind: kind, target_id: id, before_image: before, row_version_before: before ? String(before.row_version) : null, changed_fields: fields });
    }
    const result: ContentWriteResult = { ok: code === null, code, steps: [{ state }], revision: row?.row_version ?? null };
    this.audit.push({ operation_id: operationId, actor_hash: write.actorHash, target_kind: kind, target_id: id,
      changed_fields: state === 'applied' ? fields : [], before_hash: before ? sha256(JSON.stringify(before)) : null,
      after_hash: row ? sha256(JSON.stringify(row)) : null, outcome: state });
    if (result.ok) this.operations.set(operationId, { mode, write: { ...write, data: {} }, result: structuredClone(result) });
    return result;
  }
  async schemaVersion() { this.check('read'); return this.version; }
  async listPosts(collection: ContentCollection | 'ready') {
    this.check('read');
    return structuredClone(this.seed.posts.filter(r => collection === 'ready' ? r.collection === 'library' && r.review_status === 'Approved' && r.queue_for_schedule === true : r.collection === collection)
      .sort((a, b) => position(a, b) || textCompare(a.library_id, b.library_id)));
  }
  async getPost(collection: ContentCollection, id: string) { this.check('read'); return structuredClone(this.seed.posts.find(r => r.collection === collection && r.library_id === id) ?? null); }
  async listSchedule() { this.check('read'); return structuredClone([...this.seed.schedule].sort((a, b) => textCompare(a.date, b.date) || textCompare(a.platform, b.platform) || textCompare(a.slot, b.slot) || textCompare(a.content_id, b.content_id))); }
  async getSchedule(id: string) { this.check('read'); return structuredClone(this.seed.schedule.find(r => r.content_id === id) ?? null); }
  async workflowSettings() { this.check('read'); return structuredClone([...this.seed.settings].sort((a, b) => position(a, b) || textCompare(a.setting, b.setting))); }
  async queueSummary(): Promise<ContentSummaryRow[]> {
    this.check('read');
    const groups = new Map<string, ContentPostRow[]>();
    for (const row of this.seed.posts.filter(r => r.collection === 'queue')) {
      const source = String(row.content_source); groups.set(source, [...groups.get(source) ?? [], row]);
    }
    return [...groups].sort(([a], [b]) => textCompare(a, b)).map(([content_source, rows]) => ({
      content_source, master_link: rows.map(r => r.source_master_file_url).filter(Boolean).sort()[0]
        ?? rows.map(r => r.source_markdown_url).filter(Boolean).sort()[0] ?? '', count: rows.length,
      counts: { Total: rows.length, 'Not Reviewed': rows.filter(r => ['', 'Not Reviewed', 'Pending'].includes(String(r.review_status))).length,
        Approved: rows.filter(r => r.review_status === 'Approved').length, Queued: rows.filter(r => r.queue_for_schedule).length,
        'Needs Fix': rows.filter(r => r.review_status === 'Changes Requested' || r.copyright_qa === 'REWORK' || ['CHECK', 'DUPLICATE'].includes(String(r.duplicate_qa))).length },
    }));
  }
}
