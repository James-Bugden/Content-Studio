import { readFileSync, readdirSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../replies/support/db';
import { buildTypedImport, typedContentRow } from '@/application/content-import';
import { buildSheetMirrorSnapshot, mirrorHash } from '@/application/sheet-mirror';
import { FINAL_SYNCED_AT_RAW_KEY } from '@/application/content-timestamps';
import { ContentExporter, ContentWriteCutover, contentExportRows } from '@/application/content-export';
import type { ContentPostRow, ContentScheduleRow, ContentSettingRow } from '@/application/content-db';
import { SupabaseContentRepository } from '@/integrations/supabase/content-repository';
import { FakeContentDb } from '@/integrations/supabase/fake-content-db';
import { FakeSheetTransport } from '@/integrations/google/fake-sheet';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';
import { LIBRARY_HEADERS, SCHEDULE_HEADERS, SHEET_TABS } from '@/domain/sheet-schema';

let db: TestDatabase;
const actor = mirrorHash('synthetic-timestamp-sql');
const query = async <T>(sql: string, params: unknown[] = []): Promise<T[]> => (await db.asService(q => q.query<T>(sql, params))).rows;
// Let PostgreSQL serialize timestamps into JSON, retaining all microseconds.
const rows = async <T>(table: string, where = '', params: unknown[] = []) =>
  (await query<{ r: T }>(`select to_jsonb(t) as r from ${table} t ${where}`, params)).map(r => r.r);
beforeAll(async () => {
  db = await createTestDatabase();
  for (const file of readdirSync('supabase/migrations').filter(f => /^\d+_content_.*\.sql$/.test(f)).sort()) {
    await db.raw.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'));
  }
}, 120_000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  vi.stubEnv('CS_CONTENT_STORE', 'db-shadow');
  await db.raw.exec('truncate content_studio_posts,content_studio_schedule,content_studio_workflow_settings,content_studio_operations,content_studio_import_runs,content_studio_audit_events,content_studio_row_history,content_studio_shadow_jobs,content_studio_shadow_lease,content_studio_shadow_events restart identity cascade');
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

function sqlReader() {
  const reader = new FakeContentDb({ posts: [], schedule: [], settings: [] });
  vi.spyOn(reader, 'schemaVersion').mockImplementation(async () => (await query<{ version: number }>('select version from content_studio_schema_version'))[0]!.version);
  vi.spyOn(reader, 'listPosts').mockImplementation(kind => kind === 'ready'
    ? rows<ContentPostRow>('content_studio_ready_queue', 'order by source_sheet_row,library_id')
    : rows<ContentPostRow>('content_studio_posts', 'where collection=$1 order by source_sheet_row,library_id', [kind]));
  vi.spyOn(reader, 'listSchedule').mockImplementation(() => rows<ContentScheduleRow>('content_studio_schedule', 'order by source_sheet_row,content_id'));
  vi.spyOn(reader, 'workflowSettings').mockImplementation(() => rows<ContentSettingRow>('content_studio_workflow_settings', 'order by source_sheet_row'));
  return reader;
}

async function imported(text: string) {
  const transport = new FakeSheetTransport(), sheet = new SheetsContentRepository(transport);
  const tab = SHEET_TABS.schedule.name, grid = transport.rawTab(tab);
  const column = grid[1]!.findIndex(c => c.value === SCHEDULE_HEADERS.finalSyncedAt);
  transport.externalEdit(tab, 3, column, text);
  const envelope = buildTypedImport(await buildSheetMirrorSnapshot(sheet, { sourceKey: 'synthetic_workbook' }), new Map(), actor);
  expect((await query<{ r: { ok: boolean } }>('select content_studio_import_run($1,$2,$3,$4,$5,$6,$7) as r',
    [envelope.operationId, envelope.snapshotHash, actor, envelope.counts, envelope.hashes, envelope.exceptions, envelope.rows]))[0]!.r.ok).toBe(true);
  const id = (await sheet.listSchedule())[0]!.value.contentId, reader = sqlReader();
  const repo = new SupabaseContentRepository(reader), exporter = new ContentExporter(reader, transport, { checkpoints: new Map(), issues: new Map(), reports: [] });
  const stored = (await rows<ContentScheduleRow>('content_studio_schedule', 'where content_id=$1', [id]))[0]!;
  return { transport, sheet, grid, column, id, reader, repo, exporter, stored };
}

describe('CS-075 complete SQL timestamp export and rollback', () => {
  it.each([
    '2026-09-20T22:59:52.1200-04:00 #synthetic-final',
    '2026-09-21T10:59:52.1200+08:00',
    '2026-09-21T02:59:52.0000Z #synthetic-final',
    '2026-09-21T02:59:52Z',
    '2026-09-21T02:59:52.123456Z #Cafe\u0301\t',
    '2026-09-21T02:59Z',
    '2026-09-20T24:00:00.000Z',
  ])('retains original bytes for %s after actual SQL normalization', async text => {
    const { grid, column, id, reader, repo, exporter, stored } = await imported(text);
    expect(stored.passthrough[FINAL_SYNCED_AT_RAW_KEY]).toBe(text);
    expect((await repo.listSchedule())[0]!.cells.finalSyncedAt).toBe(text);
    expect((await repo.listSchedule())[0]!.passthrough).not.toHaveProperty(FINAL_SYNCED_AT_RAW_KEY);
    expect((await contentExportRows(reader)).find(r => r.kind === 'schedule' && r.id === id)!.cells[SCHEDULE_HEADERS.finalSyncedAt]!.value).toBe(text);
    const original = Buffer.from(JSON.stringify(grid));
    expect((await exporter.parity()).exact).toBe(true);
    expect((await exporter.run()).exact).toBe(true);
    const flip = vi.fn();
    const rollback = await new ContentWriteCutover(repo, exporter).rollbackToSheet(flip);
    expect(rollback.parity).toMatchObject({ exact: true, dbHash: rollback.parity.sheetHash });
    expect(flip).toHaveBeenCalledWith('sheet');
    expect(Buffer.from(grid[2]![column]!.value as string)).toEqual(Buffer.from(text));
    expect(Buffer.from(JSON.stringify(grid))).toEqual(original);
  });

  it.each([
    { patch: { final_synced_at: '2026-09-21T02:59:53.123456Z' }, expected: '2026-09-21T10:59:53.123456+08:00 #synthetic-final' },
    { patch: { final_synced_at: '2026-09-21T02:59:52.120001Z' }, expected: '2026-09-21T10:59:52.120001+08:00 #synthetic-final' },
    { patch: { final_synced_hash: 'synthetic-new' }, expected: '2026-09-21T10:59:52.12+08:00 #synthetic-new' },
    { patch: { final_synced_hash: '' }, expected: '2026-09-21T10:59:52.12+08:00' },
    { patch: { final_synced_at: null, final_synced_hash: '' }, expected: '' },
  ])('discards stale preserved text after a SQL edit: $expected', async ({ patch, expected }) => {
    const text = '2026-09-20T22:59:52.1200-04:00 #synthetic-final';
    const { grid, column, id, reader, repo, exporter, stored } = await imported(text);
    expect((await exporter.run()).exact).toBe(true);
    const result = await query<{ r: { ok: boolean } }>('select content_studio_apply_patch($1,$2,$3,$4,$5,$6,$7) as r',
      ['synthetic-timestamp-edit', mirrorHash(patch), actor, 'schedule', id, stored.row_version, patch]);
    expect(result[0]!.r.ok).toBe(true);
    const edited = (await rows<ContentScheduleRow>('content_studio_schedule', 'where content_id=$1', [id]))[0]!;
    expect(edited.passthrough[FINAL_SYNCED_AT_RAW_KEY]).toBe(text); // Guard, rather than cleanup, prevents stale export.
    expect((await repo.listSchedule())[0]!.cells.finalSyncedAt).toBe(expected);
    expect((await contentExportRows(reader)).find(r => r.kind === 'schedule' && r.id === id)!.cells[SCHEDULE_HEADERS.finalSyncedAt]!.value).toBe(expected);
    expect((await exporter.parity()).exact).toBe(false);
    const rollback = await new ContentWriteCutover(repo, exporter).rollbackToSheet(vi.fn());
    expect(rollback.parity).toMatchObject({ exact: true, dbHash: rollback.parity.sheetHash });
    expect(grid[2]![column]!.value).toBe(expected);
  });

  it('keeps preserved text after a SQL patch for the same instant', async () => {
    const text = '2026-09-20T22:59:52.1200-04:00 #synthetic-final';
    const { grid, column, id, repo, exporter, stored } = await imported(text);
    expect((await query<{ r: { ok: boolean } }>('select content_studio_apply_patch($1,$2,$3,$4,$5,$6,$7) as r',
      ['synthetic-same-timestamp', mirrorHash('synthetic-same-timestamp'), actor, 'schedule', id, stored.row_version,
        { final_synced_at: '2026-09-21T02:59:52.12Z' }]))[0]!.r.ok).toBe(true);
    expect((await repo.listSchedule())[0]!.cells.finalSyncedAt).toBe(text);
    expect((await new ContentWriteCutover(repo, exporter).rollbackToSheet(vi.fn())).parity.exact).toBe(true);
    expect(grid[2]![column]!.value).toBe(text);
  });

  it.each(['invalid', '2026-02-30T02:59:52Z #synthetic-final', 123])('never trusts malformed preserved metadata: %s', async text => {
    const { id, repo, stored } = await imported('2026-09-21T02:59:52Z #synthetic-final');
    await query('update content_studio_schedule set passthrough=$1 where content_id=$2', [{ ...stored.passthrough, [FINAL_SYNCED_AT_RAW_KEY]: text }, id]);
    expect((await repo.listSchedule())[0]!.cells.finalSyncedAt).toBe('2026-09-21T10:59:52+08:00 #synthetic-final');
  });

  it('strips internal timestamp metadata from Library and Queue without adding a timestamp field', async () => {
    const sheet = new SheetsContentRepository(new FakeSheetTransport());
    for (const kind of ['library', 'queue'] as const) {
      const source = (await (kind === 'library' ? sheet.listLibrary() : sheet.listQueue()))[0]!;
      source.passthrough = { '33': { header: 'Synthetic extra', value: 'exact\t' }, [FINAL_SYNCED_AT_RAW_KEY]: '2026-09-21T02:59:52Z' };
      const typed = typedContentRow(kind, source.value.libraryId, source);
      expect(typed).not.toHaveProperty('final_synced_at'); // Current Library/Queue schemas have no such field.
      const reader = new FakeContentDb({ posts: [{ ...typed, collection: kind, library_id: source.value.libraryId, row_version: 1 } as ContentPostRow], schedule: [], settings: [] });
      const repo = new SupabaseContentRepository(reader);
      const actual = (await (kind === 'library' ? repo.listLibrary() : repo.listQueue()))[0]!;
      expect(actual.cells).not.toHaveProperty('finalSyncedAt');
      expect(actual.passthrough).toEqual({ '33': { header: 'Synthetic extra', value: 'exact\t' } });
      const exported = (await contentExportRows(reader))[0]!;
      expect(exported.cells['Synthetic extra']).toEqual({ value: 'exact\t' });
      expect(exported.cells[LIBRARY_HEADERS.libraryId]!.value).toBe(source.value.libraryId);
    }
  });
});
