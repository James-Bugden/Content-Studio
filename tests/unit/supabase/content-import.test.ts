import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTypedImport, classifyDifference, importVersions, runTypedImport } from '@/application/content-import';
import { buildSheetMirrorSnapshot, evidenceHash, mirrorHash } from '@/application/sheet-mirror';
import { FakeSheetTransport } from '@/integrations/google/fake-sheet';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';
import { FakeContentImportStore } from '@/integrations/supabase/fake-content-import';
import { SupabaseContentImportStore } from '@/integrations/supabase/content-import-store';
import { SupabaseContentRepository } from '@/integrations/supabase/content-repository';
import { compareContent } from '@/application/content-parity';

beforeEach(() => vi.stubEnv('CS_CONTENT_STORE', 'db-shadow'));
afterEach(() => vi.unstubAllEnvs());

const actor = mirrorHash('synthetic-import-actor');
const sheet = () => new SheetsContentRepository(new FakeSheetTransport());
const snapshot = () => buildSheetMirrorSnapshot(sheet(), { sourceKey: 'synthetic_workbook' });
describe('MIG-09 typed complete imports', () => {
  it.each([
    ['views', '007', 7, 'number_formatting'], ['views', ' 12', 12, 'number_formatting'],
    ['views', '1,234', 1234, 'number_formatting'], ['posted', '', false, 'blank_boolean'],
    ['posted', 'yes', true, 'boolean_formatting'], ['posted', '1', true, 'boolean_formatting'],
    ['publishedAt', '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z', 'timestamp_formatting'],
    ['finalSyncedAt', '2026-10-01T00:00:00Z #abc', '2026-10-01T00:00:00Z', 'timestamp_formatting'],
  ])('records every changed representation: %s=%s', async (field, text, value, kind) => {
    const source = await snapshot(), row = source.rows.find(r => r.collection === 'schedule')!;
    const record = row.payload as { cells: Record<string, string> };
    record.cells[field as string] = text as string; row.rowHash = mirrorHash(record);
    const e = buildTypedImport(source, new Map(), actor);
    const column = String(field).replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
    expect(e.rows.find(r => r.target_id === row.stableId)?.row[column]).toBe(value);
    expect(e.exceptions).toContainEqual({ class: kind, collection: 'schedule', field: column,
      hash: evidenceHash({ collection: 'schedule', field: column, id: row.stableId, value: text }) });
  });
  it.each(['2026-10-01T00:00:00+08:00 #abc #lost', ' #hash', '2026-10-01T00:00:00+08:00 #'])('blocks ambiguous sync stamps: %s', async text => {
    const source = await snapshot(), row = source.rows.find(r => r.collection === 'schedule')!;
    (row.payload as { cells: { finalSyncedAt: string } }).cells.finalSyncedAt = text;
    row.rowHash = mirrorHash(row.payload);
    expect(() => buildTypedImport(source, new Map(), actor)).toThrowError(expect.objectContaining({ code: 'VALIDATION_FAILED' }));
  });
  it.each(['sheet', 'db-read', 'db', ''])('refuses imports in %s before reads or writes, including direct store calls', async mode => {
    const source = await snapshot(), store = new FakeContentImportStore();
    const envelope = buildTypedImport(source, new Map(), actor);
    const read = vi.spyOn(store.db, 'listPosts');
    const apply = vi.spyOn(store, 'applyImport');
    vi.stubEnv('CS_CONTENT_STORE', mode);
    expect(() => buildTypedImport(source, new Map(), actor)).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
    await expect(runTypedImport(sheet(), store, 'synthetic_workbook', actor)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(read).not.toHaveBeenCalled(); expect(apply).not.toHaveBeenCalled();
    await expect(store.applyImport(envelope)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const client = new SupabaseContentImportStore({ url: 'https://synthetic.supabase.co', serviceKey: 'synthetic-service-key-for-tests', fetch: vi.fn() });
    await expect(client.applyImport(envelope)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('keys private evidence with the existing auth secret', () => {
    vi.stubEnv('AUTH_SECRET', 'synthetic-secret-for-evidence-key-one');
    const one = evidenceHash('007');
    expect(one).not.toBe(mirrorHash('007'));
    expect(evidenceHash('007')).toBe(one);
    vi.stubEnv('AUTH_SECRET', 'synthetic-secret-for-evidence-key-two');
    expect(evidenceHash('007')).not.toBe(one);
  });
  it('imports the whole synthetic corpus and round-trips adapter fields, links, IDs and settings', async () => {
    const repo = sheet(), store = new FakeContentImportStore({ posts: [], schedule: [], settings: [] });
    const result = await runTypedImport(repo, store, 'synthetic_workbook', actor);
    expect(result.counts.library).toBeGreaterThan(0);
    const db = new SupabaseContentRepository(store.db, 'db-read');
    for (const [method, collection] of [['listLibrary', 'library'], ['listQueue', 'queue'], ['listReadyQueue', 'ready'], ['listSchedule', 'schedule'], ['queueSummary', 'queue_summary'], ['workflowSettings', 'workflow_settings']] as const) {
      const report = compareContent(collection, await repo[method](), await db[method](), Date.now(), Date.now());
      expect(report.facts).toEqual([]);
      expect(report.idsEqual).toBe(true);
    }
    await expect(runTypedImport(repo, store, 'synthetic_workbook', actor)).resolves.toBeDefined();
  });
  it('classifies formula display and 1,234 formatting; arbitrary lost formula text stays blocking', async () => {
    const source = await snapshot();
    const row = source.rows.find(r => r.collection === 'schedule')!;
    const record = row.payload as { cells: { views: string; hasImage: string }; formulaFields: string[] };
    record.cells.views = '1,234'; record.cells.hasImage = 'Synthetic display'; record.formulaFields.push('hasImage');
    row.rowHash = mirrorHash(row.payload);
    const e = buildTypedImport(source, new Map(), actor);
    expect(e.exceptions).toEqual(expect.arrayContaining([expect.objectContaining({ class: 'number_formatting', field: 'views' }), expect.objectContaining({ class: 'formula_display', field: 'has_image' })]));
    expect(e.rows.find(r => r.target_id === row.stableId)?.row.views).toBe(1234);
    expect(classifyDifference('text  ', 'text', 'nextAction')).toBe('trailing_whitespace');
    expect(classifyDifference('expected', 'lost', 'hasImage')).toBe(null);
    record.cells.views = 'not a number'; row.rowHash = mirrorHash(row.payload);
    expect(() => buildTypedImport(source, new Map(), actor)).toThrowError(expect.objectContaining({ code: 'VALIDATION_FAILED' }));
  });
  it('binds counts, collection hashes, rows and exceptions into the canonical snapshot hash', async () => {
    const source = await snapshot();
    const e = buildTypedImport(source, new Map(), actor);
    expect(e.snapshotHash).toBe(mirrorHash({ counts: e.counts, hashes: e.hashes, rows: e.rows, exceptions: e.exceptions }));
    for (const body of [{ counts: { ...e.counts, library: 0 } }, { exceptions: [{ class: 'trailing_whitespace' }] }, { rows: [] }, { hashes: {} }]) {
      const changed = { counts: e.counts, hashes: e.hashes, rows: e.rows, exceptions: e.exceptions, ...body };
      expect(mirrorHash(changed)).not.toBe(e.snapshotHash);
    }
    expect(JSON.stringify(e.exceptions)).not.toContain('Synthetic');
  });
  it('preserves unknown columns and exact setting rows, and refuses duplicate setting IDs', async () => {
    const source = await snapshot();
    const post = source.rows.find(r => r.collection === 'library')!;
    Object.assign(post.payload as object, { passthrough: { '34': { header: 'Synthetic extra', value: 'Synthetic text  ', formula: '', link: '' } } });
    post.rowHash = mirrorHash(post.payload);
    const settings = source.rows.find(r => r.collection === 'workflow_settings')!;
    const raw = (settings.payload as { sourceRows: { setting: string; value: string; notes: string; row: number }[] }).sourceRows;
    raw[0]!.value += '  '; raw[0]!.notes = 'Synthetic note  ';
    settings.rowHash = mirrorHash(settings.payload);
    const e = buildTypedImport(source, new Map(), actor);
    expect(e.rows.find(r => r.target_id === post.stableId)?.row.passthrough).toEqual((post.payload as { passthrough: unknown }).passthrough);
    expect(e.rows.find(r => r.target_kind === 'workflow_settings' && r.target_id === raw[0]!.setting)?.row).toEqual({ value: raw[0]!.value, notes: raw[0]!.notes, source_sheet_row: raw[0]!.row });
    raw.push(structuredClone(raw[0]!)); settings.rowHash = mirrorHash(settings.payload);
    expect(() => buildTypedImport(source, new Map(), actor)).toThrow();
  });
  it('does not apply a partial snapshot and retries a failed import on the next run', async () => {
    const repo = sheet(), store = new FakeContentImportStore();
    const apply = vi.spyOn(store, 'applyImport');
    const before = await store.db.listPosts('library');
    const read = vi.spyOn(repo, 'listQueue').mockRejectedValueOnce(new Error('synthetic unavailable'));
    await expect(runTypedImport(repo, store, 'synthetic_workbook', actor)).rejects.toThrow();
    expect(apply).not.toHaveBeenCalled();
    expect(await store.db.listPosts('library')).toEqual(before);
    read.mockRestore(); store.failNext = true;
    await expect(runTypedImport(repo, store, 'synthetic_workbook', actor)).rejects.toThrow();
    await expect(runTypedImport(repo, store, 'synthetic_workbook', actor)).resolves.toBeDefined();
    expect(apply).toHaveBeenCalledTimes(2);
  });
  it('captures versions before Sheet reads and fails atomically on a late conflict', async () => {
    const store = new FakeContentImportStore();
    const versions = await importVersions(store.db), source = await snapshot();
    const e = buildTypedImport(source, versions, actor);
    e.rows[0]!.row.draft_content = 'Synthetic change'; e.rows[0]!.expected_version = 999;
    e.snapshotHash = mirrorHash({ counts: e.counts, hashes: e.hashes, rows: e.rows, exceptions: e.exceptions });
    const before = await store.db.listPosts('library');
    await expect(store.applyImport(e)).rejects.toThrow();
    expect(await store.db.listPosts('library')).toEqual(before);
  });
  it('only posts the redacted-envelope RPC through the explicit client, with timeout and safe failures', async () => {
    const e = buildTypedImport(await snapshot(), new Map(), actor);
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ ok: true, code: null, steps: [{ state: 'applied' }], revision: null })));
    const store = new SupabaseContentImportStore({ url: 'https://synthetic.supabase.co', serviceKey: 'synthetic-service-key-for-tests', fetch: request });
    await store.applyImport(e);
    const [url, init] = request.mock.calls[0]!;
    expect(url).toBe('https://synthetic.supabase.co/rest/v1/rpc/content_studio_import_run');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(init?.body)).p_snapshot_hash).toBe(e.snapshotHash);
    request.mockResolvedValueOnce(new Response('synthetic private provider details', { status: 500 }));
    await expect(store.applyImport(e)).rejects.toThrowError(expect.objectContaining({ code: 'PROVIDER_UNAVAILABLE' }));
  });
});
