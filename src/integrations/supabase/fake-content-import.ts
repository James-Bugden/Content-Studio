import 'server-only';
import { assertImportMode, type ContentImportStore, type ImportEnvelope } from '@/application/content-import';
import type { ContentPostRow, ContentScheduleRow, ContentSettingRow } from '@/application/content-db';
import { mirrorHash } from '@/application/sheet-mirror';
import { AppError } from '@/domain/errors';
import { FakeContentDb, syntheticContentDbSeed } from './fake-content-db';

/** Separate import fake; DB-3 owns FakeContentDb's interactive mutation path. */
export class FakeContentImportStore implements ContentImportStore {
  private reader: FakeContentDb;
  private operations = new Map<string, string>();
  failNext = false;
  constructor(seed = syntheticContentDbSeed(), db?: FakeContentDb) { this.reader = db ?? new FakeContentDb(seed); }
  get db() { return this.reader; }
  async applyImport(e: ImportEnvelope) {
    assertImportMode();
    const hash = mirrorHash({ counts: e.counts, hashes: e.hashes, exceptions: e.exceptions, rows: e.rows });
    if (hash !== e.snapshotHash) throw new AppError('VALIDATION_FAILED');
    const identity = mirrorHash([hash, e.actorHash]);
    const old = this.operations.get(e.operationId);
    if (old) { if (old !== identity) throw new AppError('CONFLICT'); return; }
    if (this.failNext) { this.failNext = false; throw new AppError('PROVIDER_UNAVAILABLE'); }
    const next = this.reader.snapshot();
    for (const r of e.rows) {
      const group = r.target_kind === 'schedule' ? next.schedule : r.target_kind === 'workflow_settings' ? next.settings : next.posts;
      const key = r.target_kind === 'schedule' ? 'content_id' : r.target_kind === 'workflow_settings' ? 'setting' : 'library_id';
      const rows = group as unknown as Record<string, unknown>[];
      const at = rows.findIndex(row => row[key] === r.target_id && (key !== 'library_id' || row.collection === r.target_kind));
      const before = rows[at];
      const same = before && Object.entries(r.row).every(([k, v]) => mirrorHash([before[k]]) === mirrorHash([v]));
      if (same) continue;
      if (String(before ? before.row_version ?? 1 : null) !== String(r.expected_version)) throw new AppError('STALE_READ');
      const contentChanged = !before || Object.entries(r.row).some(([k, v]) => !['source_sheet_row', 'sheet_revision'].includes(k) && mirrorHash([before[k]]) !== mirrorHash([v]));
      const after = { ...before, ...r.row, [key]: r.target_id, ...(key === 'library_id' ? { collection: r.target_kind } : {}), row_version: before ? Number(before.row_version ?? 1) + Number(contentChanged) : 1 };
      if (at < 0) rows.push(after); else rows[at] = after;
    }
    // Publish only after the entire batch has succeeded. Missing rows stay visible to parity.
    this.reader.replaceSnapshot({ posts: next.posts as ContentPostRow[], schedule: next.schedule as ContentScheduleRow[], settings: next.settings as ContentSettingRow[] });
    this.operations.set(e.operationId, identity);
  }
}
