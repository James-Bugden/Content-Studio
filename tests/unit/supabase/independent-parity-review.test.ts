import { readFileSync, readdirSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../replies/support/db';
import { classifyDifference, typedContentRow, buildTypedImport } from '@/application/content-import';
import { compareContent } from '@/application/content-parity';
import { isReadyQueuePlaceholder } from '@/application/sheet-records';
import { buildSheetMirrorSnapshot, mirrorHash } from '@/application/sheet-mirror';
import { deriveQueueSummary } from '@/application/queue-summary';
import { contentExportRows, ContentExporter, ContentWriteCutover } from '@/application/content-export';
import { FakeSheetTransport } from '@/integrations/google/fake-sheet';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';
import { FakeContentDb } from '@/integrations/supabase/fake-content-db';
import { SupabaseContentRepository } from '@/integrations/supabase/content-repository';
import { LIBRARY_HEADERS, SCHEDULE_HEADERS, SHEET_TABS, discoverHeaders } from '@/domain/sheet-schema';
import { toLibraryRecord } from '@/domain/mapping';
import type { ContentPostRow, ContentScheduleRow, ContentSettingRow } from '@/application/content-db';

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
const sample = (left: string, right: string, field = 'finalSyncedAt') => compareContent('schedule',
  [{ cells: { [field]: left }, value: { contentId: 'SYN-STAMP', [field]: left } }],
  [{ cells: { [field]: right }, value: { contentId: 'SYN-STAMP', [field]: right } }], 1, 0);

describe('Independent timestamp attacks', () => {
  it.each([
    ['2026-09-21T10:59:52+08:00', '2026-09-21T02:59:52.000000Z'],
    ['2026-09-21T10:59:52.12345600+08:00', '2026-09-21T02:59:52.123456Z'],
  ])('permits equal final instants only: %s', (left, right) => {
    expect(classifyDifference(left, right, 'finalSyncedAt')).toBe('timestamp_formatting');
    expect(sample(left, right).blocking).toBe(0);
  });
  it.each([
    ['2026-09-21T10:59:52+08:00', '2026-09-21T10:59:52Z'],
    ['2026-09-21T02:59:52Z', '2026-09-21T02:59:53Z'],
    ['2026-09-21T02:59:52.123456Z', '2026-09-21T02:59:52.123457Z'],
    ['2026-11-01T01:30:00', '2026-11-01T01:30:00-04:00'],
    ['', '2026-09-21T02:59:52Z'],
    ['nonsense', 'different nonsense'],
  ])('blocks different, blank or ambiguous stamps: %s', (left, right) => expect(sample(left, right).blocking).toBe(2));
  it('rejects an invalid calendar day instead of silently rolling it into March', async () => {
    expect(sample('2026-02-30T02:59:52Z', '2026-03-02T02:59:52+00:00').blocking).toBe(2);
  });
  it('refuses importing an invalid calendar day', async () => {
    const row = (await new SheetsContentRepository(new FakeSheetTransport()).listSchedule())[0]!;
    row.cells.finalSyncedAt = '2026-02-30T02:59:52Z';
    expect(() => typedContentRow('schedule', row.value.contentId, row)).toThrow();
  });
  it.each(['publishedAt', 'analyticsSyncedAt', 'content', 'hook', 'finalContent'])('keeps %s outside the requested finalSyncedAt equality exception', field => {
    expect(sample('2026-09-21T10:59:52+08:00', '2026-09-21T02:59:52Z', field).blocking).toBeGreaterThan(0);
  });
});

const library = (cells: Record<string, string>) => {
  const found = discoverHeaders(LIBRARY_HEADERS, Object.values(LIBRARY_HEADERS));
  if (!found.ok) throw new Error('Synthetic headers');
  return toLibraryRecord(found.index, { values: Object.keys(LIBRARY_HEADERS).map(field => cells[field] ?? '') }, 2);
};
describe('Independent row and summary attacks', () => {
  it.each(['No posts queued ', ' No posts queued', 'No posts queued\u00a0', 'Ｎｏ posts queued', 'No posts queue\u0064\u0301', 'No posts queued soon'])('retains a near-sentinel ID: %s', libraryId => {
    const record = library({ libraryId });
    expect(isReadyQueuePlaceholder(record)).toBe(false);
    expect(compareContent('ready', [record], [], 1, 0).blocking).toBe(1);
  });
  it.each([' ', '\t', '\u00a0', 'x'])('retains a sentinel with another nonblank cell: %j', draftContent => {
    expect(isReadyQueuePlaceholder(library({ libraryId: 'No posts queued', draftContent }))).toBe(false);
  });
  it('skips a placeholder alongside a real post and still catches post loss even with the same summary', () => {
    const a = library({ libraryId: 'SYN-A', contentSource: 'Source' }), b = library({ libraryId: 'SYN-B', contentSource: 'Source' });
    expect(compareContent('ready', [library({ libraryId: 'No posts queued' }), a], [a], 1, 0).blocking).toBe(0);
    expect(compareContent('queue_summary', deriveQueueSummary([a]), deriveQueueSummary([b]), 1, 0).blocking).toBe(0);
    expect(compareContent('queue', [a], [b], 1, 0)).toMatchObject({ idsEqual: false, blocking: 2 });
  });
});

let db: TestDatabase;
beforeAll(async () => {
  db = await createTestDatabase();
  for (const f of readdirSync('supabase/migrations').filter(f => /^\d+_content_.*\.sql$/.test(f)).sort()) await db.raw.exec(readFileSync(`supabase/migrations/${f}`, 'utf8'));
}, 120000);
afterAll(async () => { await db?.close(); });
describe('Independent real SQL timestamp export and rollback', () => {
  it('preserves the original Sheet timestamp bytes across import, export and rollback', async () => {
    vi.stubEnv('CS_CONTENT_STORE', 'db-shadow');
    const text = '2026-09-20T22:59:52.1200-04:00 #synthetic-final';
    const transport = new FakeSheetTransport(), sheet = new SheetsContentRepository(transport);
    const grid = transport.rawTab(SHEET_TABS.schedule.name);
    const column = grid[1]!.findIndex(c => c.value === SCHEDULE_HEADERS.finalSyncedAt);
    transport.externalEdit(SHEET_TABS.schedule.name, 3, column, text);
    const envelope = buildTypedImport(await buildSheetMirrorSnapshot(sheet, { sourceKey: 'synthetic_workbook' }), new Map(), mirrorHash('synthetic-reviewer'));
    const query = async <T>(sql: string, params: unknown[] = []): Promise<T[]> => JSON.parse(JSON.stringify((await db.asService(q => q.query<T>(sql, params))).rows));
    expect((await query<{ result: { ok: boolean } }>('select content_studio_import_run($1,$2,$3,$4,$5,$6,$7) as result', [envelope.operationId, envelope.snapshotHash, envelope.actorHash, envelope.counts, envelope.hashes, envelope.exceptions, envelope.rows]))[0]!.result.ok).toBe(true);
    const reader = new FakeContentDb({ posts: await query<ContentPostRow>('select * from content_studio_posts'), schedule: await query<ContentScheduleRow>('select * from content_studio_schedule'), settings: await query<ContentSettingRow>('select * from content_studio_workflow_settings') });
    const id = (await sheet.listSchedule())[0]!.value.contentId;
    const exportRow = (await contentExportRows(reader)).find(r => r.kind === 'schedule' && r.id === id)!;
    expect.soft(exportRow.cells[SCHEDULE_HEADERS.finalSyncedAt]!.value).toBe(text);
    const exporter = new ContentExporter(reader, transport, { checkpoints: new Map(), issues: new Map(), reports: [] });
    const rollback = await new ContentWriteCutover(new SupabaseContentRepository(reader), exporter).rollbackToSheet(vi.fn());
    expect(rollback.parity.exact).toBe(true);
    expect.soft(grid[2]![column]!.value).toBe(text);
  });
});
