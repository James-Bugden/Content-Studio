import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContentRepository } from '@/application/ports';
import { ContentReadCutoverRepository } from '@/application/content-read-cutover';
import { FakeSheetTransport } from '@/integrations/google/fake-sheet';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';
import { FakeContentDb, syntheticContentDbSeed } from '@/integrations/supabase/fake-content-db';
import { SupabaseContentRepository } from '@/integrations/supabase/content-repository';
import { syntheticScheduleRows, SCHEDULE_ORDER } from '@/fixtures/synthetic';
import { SHEET_TABS } from '@/domain/sheet-schema';
import { fingerprintValues } from '@/domain/hash';
import { getServices, resetServices } from '@/application/container';
import { resetEnvCache } from '@/lib/env';
import { capabilities } from '@/application/capabilities';
import { capabilityMessage } from '@/components/capability-banner';

// SQL's specified schedule order is date/platform/slot. Give BOTH adapters the
// same synthetic corpus in that order; Sheet otherwise preserves workbook order.
function sheet() {
  const rows = syntheticScheduleRows();
  const columns = ['date', 'platform', 'slot', 'contentId'].map(f => SCHEDULE_ORDER.indexOf(f as typeof SCHEDULE_ORDER[number]));
  const ordered = rows.slice(2).sort((a, b) => {
    for (const i of columns) { const x = String(a.values[i]), y = String(b.values[i]); if (x !== y) return x < y ? -1 : 1; }
    return 0;
  });
  return new SheetsContentRepository(new FakeSheetTransport({ [SHEET_TABS.schedule.name]: [...rows.slice(0, 2), ...ordered] }));
}
const factories: [string, () => ContentRepository][] = [
  ['Sheet fake', sheet], ['DB-read / Sheet authority', () => new ContentReadCutoverRepository(sheet(), new FakeContentDb())], ['DB fake', () => new SupabaseContentRepository(new FakeContentDb())],
];
const listMethods = ['listLibrary', 'listQueue', 'listReadyQueue', 'listSchedule'] as const;
const visible = (row: Awaited<ReturnType<ContentRepository['listLibrary']>>[number] | Awaited<ReturnType<ContentRepository['listSchedule']>>[number]) => ({ value: row.value, cells: row.cells, links: row.links });

describe.each(factories)('MIG-14 reads: %s', (_name, create) => {
  for (const method of listMethods) it(`${method}: identical complete values, cells, links and ordering`, async () => {
    const repo = create();
    const actual = await repo[method]();
    const expected = await sheet()[method]();
    expect(actual.length).toBeGreaterThan(0);
    expect(actual.map(visible)).toEqual(expected.map(visible));
    expect(actual.map(r => r.revision)).toEqual((await repo[method]()).map(r => r.revision));
    for (const row of actual) expect(row.revision).toMatch(/^[0-9a-f]{16}$/);
  });
  it('gets every stable key and distinguishes missing rows', async () => {
    const repo = create();
    for (const row of await repo.listLibrary()) expect(await repo.getLibrary(row.value.libraryId)).toEqual(row);
    for (const row of await repo.listQueue()) expect(await repo.getQueue(row.value.libraryId)).toEqual(row);
    for (const row of await repo.listSchedule()) expect(await repo.getSchedule(row.value.contentId)).toEqual(row);
    for (const get of [() => repo.getLibrary('MISSING'), () => repo.getQueue('MISSING'), () => repo.getSchedule('MISSING')]) await expect(get()).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('serves the same settings and named summary counts', async () => {
    // syntheticQueueSummaryRows and the DB summary derive from the same Queue
    // rows/rules. This proves self-consistency, not parity with the real Sheet
    // summary tab; DB-4's real-Sheet parity report is the acceptance check.
    const repo = create();
    expect(await repo.schema()).toMatchObject({ ok: true });
      // sourceRows is import-only metadata; DB row positions are not Sheet positions.
      const { sourceRows: dbRows, ...dbSettings } = await repo.workflowSettings();
      const { sourceRows: sheetRows, ...sheetSettings } = await sheet().workflowSettings();
      expect(dbRows).toBeDefined(); expect(sheetRows).toBeDefined();
      expect(dbSettings).toEqual(sheetSettings);
    expect(await repo.queueSummary()).toEqual(await sheet().queueSummary());
    expect((await repo.queueSummary())[0]!.counts).toHaveProperty('Needs Fix');
  });
  it('retains master hyperlinks through the derived Ready Queue', async () => {
    const repo = create();
    for (const row of await repo.listReadyQueue()) expect(row.links).toEqual((await repo.getLibrary(row.value.libraryId)).links);
  });
});

describe('DB revision and failure contracts', () => {
  it('orders nullable source positions last with a stable-ID tie break and isolates collections', async () => {
    const seed = syntheticContentDbSeed();
    const row = seed.posts[0]!;
    seed.posts = [
      { ...row, library_id: 'SYN-C', source_sheet_row: null },
      { ...row, library_id: 'SYN-B', source_sheet_row: 4 },
      { ...row, library_id: 'SYN-A', source_sheet_row: 4 },
      { ...row, library_id: 'SYN-A', collection: 'queue', source_sheet_row: 4 },
    ];
    const repo = new SupabaseContentRepository(new FakeContentDb(seed));
    expect((await repo.listLibrary()).map(r => r.value.libraryId)).toEqual(['SYN-A', 'SYN-B', 'SYN-C']);
    expect((await repo.getLibrary('SYN-A')).revision).not.toBe((await repo.getQueue('SYN-A')).revision);
  });
  it('preserves nullable summary counts and distinguishes null from zero', async () => {
    const db = new FakeContentDb();
    vi.spyOn(db, 'queueSummary').mockResolvedValue([{ content_source: 'Synthetic', master_link: '', count: 0, counts: { Total: 0, Optional: null } }]);
    expect(await new SupabaseContentRepository(db).queueSummary()).toEqual([{ source: 'Synthetic', masterLink: '', counts: { Total: 0, Optional: null } }]);
  });
  it('binds DB revisions to collection, key and row_version, independent of metadata', async () => {
    const seed = syntheticContentDbSeed();
    const first = seed.posts[0]!;
    const id = String(first.library_id);
    const read = () => new SupabaseContentRepository(new FakeContentDb(seed)).getLibrary(id);
    const before = await read();
    expect(before.revision).toBe(fingerprintValues(['db', 'content_studio_posts', `library:${id}`, '1']));
    first.source_sheet_row = 999; first.sheet_revision = 'f'.repeat(16);
    expect((await read()).revision).toBe(before.revision);
    first.draft_content = 'Synthetic changed copy'; first.row_version = 2;
    expect((await read()).revision).not.toBe(before.revision);
    expect((await read()).revision).toBe((await read()).revision);
  });
  it('serves imported Sheet revisions only in db-read mode', async () => {
    const repo = new SupabaseContentRepository(new FakeContentDb(), 'db-read');
    const source = new SheetsContentRepository(new FakeSheetTransport());
    expect((await repo.listLibrary()).map(r => r.revision)).toEqual((await source.listLibrary()).map(r => r.revision));
    const seed = syntheticContentDbSeed(); seed.posts[0]!.sheet_revision = null;
    await expect(new SupabaseContentRepository(new FakeContentDb(seed), 'db-read').listLibrary()).rejects.toMatchObject({ code: 'SCHEMA_DRIFT' });
  });
  it('fails closed on every read and schema probe for a missing or mismatched version', async () => {
    for (const version of [null, 999, '1']) {
      const repo = new SupabaseContentRepository(new FakeContentDb(syntheticContentDbSeed(), version));
      for (const method of [...listMethods, 'schema', 'workflowSettings', 'queueSummary'] as const) await expect(repo[method]()).rejects.toMatchObject({ code: 'SCHEMA_DRIFT', details: { kind: 'version' } });
      await expect(repo.getLibrary('MISSING')).rejects.toMatchObject({ code: 'SCHEMA_DRIFT' });
    }
  });
  it('rejects malformed typed rows instead of silently defaulting cells', async () => {
    const seed = syntheticContentDbSeed(); Object.assign(seed.posts[0]!, { hook_score: 'invalid' });
    await expect(new SupabaseContentRepository(new FakeContentDb(seed)).listLibrary()).rejects.toMatchObject({ code: 'SCHEMA_DRIFT' });
  });
  it('refuses db-read writes without changing the seeded data', async () => {
    const repo = new SupabaseContentRepository(new FakeContentDb(), 'db-read');
    const before = await repo.listLibrary();
    const actor = { sub: 'synthetic-owner', role: 'owner' as const };
    const m = { actor, operationId: 'SYNTH-op-0001', expectedRevision: before[0]!.revision, target: { libraryId: before[0]!.value.libraryId }, patch: { draftContent: 'Synthetic change' } };
    for (const result of [await repo.updateLibrary(m), await repo.updateQueue(m), await repo.updateSchedule({ ...m, target: { contentId: 'SYNTH' }, patch: { content: 'Synthetic change' } }), await repo.createQueueIdea({ actor, operationId: m.operationId, libraryId: 'SYNTH', sourcePlatform: 'X', currentHook: 'Synthetic', draftContent: 'Synthetic' })]) expect(result).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(await repo.listLibrary()).toEqual(before);
    expect(repo.capability()).toEqual({ provider: 'db', state: 'read_only', mode: 'fake' });
  });
  it('returns detached fake records', async () => {
    const db = new FakeContentDb(); const rows = await db.listPosts('library'); rows[0]!.draft_content = 'Changed externally';
    expect((await db.listPosts('library'))[0]!.draft_content).not.toBe('Changed externally');
  });
});

afterEach(() => { vi.unstubAllEnvs(); resetEnvCache(); resetServices(); });
describe('composition', () => {
  it.each(['sheet', 'db-shadow', 'db-read', 'db'])('selects %s in fake mode without credentials', async mode => {
    vi.stubEnv('CS_DATA_MODE', 'fake'); vi.stubEnv('CS_CONTENT_STORE', mode); resetEnvCache(); resetServices();
    const repo = getServices().repo;
    expect(repo.capability().provider).toBe(mode === 'db' || mode === 'db-read' ? 'db' : 'sheet');
    expect(repo.capability().state).toBe('ready');
    expect(capabilities().some(c => c.provider === 'db')).toBe(mode === 'db' || mode === 'db-read');
    expect((await repo.listLibrary()).length).toBeGreaterThan(0);
    expect((await repo.listReadyQueue()).length).toBeGreaterThan(0);
    expect((await repo.listSchedule()).length).toBeGreaterThan(0);
  });
  it('names the selected database read-only capability', () => {
    expect(capabilityMessage({ provider: 'db', state: 'read_only', mode: 'fake' })).toBe('Content database read-only: content saving is disabled; review still works');
  });
  it.each(['db-shadow', 'db-read', 'db'])('blocks premature live cutover to %s', mode => {
    vi.stubEnv('CS_DATA_MODE', 'live'); vi.stubEnv('CS_CONTENT_STORE', mode); resetEnvCache(); resetServices();
    expect(() => getServices()).toThrow('not enabled for live data');
  });
});
