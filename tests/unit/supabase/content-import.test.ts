import { describe, expect, it, vi } from 'vitest';
import { buildTypedImport, classifyDifference, importVersions, runTypedImport } from '@/application/content-import';
import { buildSheetMirrorSnapshot, mirrorHash } from '@/application/sheet-mirror';
import { FakeSheetTransport } from '@/integrations/google/fake-sheet';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';
import { FakeContentImportStore } from '@/integrations/supabase/fake-content-import';
import { SupabaseContentImportStore } from '@/integrations/supabase/content-import-store';
import { SupabaseContentRepository } from '@/integrations/supabase/content-repository';
import { compareContent } from '@/application/content-parity';

const actor = mirrorHash('synthetic-import-actor');
const sheet = () => new SheetsContentRepository(new FakeSheetTransport());
const snapshot = () => buildSheetMirrorSnapshot(sheet(), { sourceKey: 'synthetic_workbook' });
describe('MIG-09 typed complete imports', () => {
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
    expect(classifyDifference('text  ', 'text')).toBe('trailing_whitespace');
    expect(classifyDifference('expected', 'lost', true)).toBe(null);
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
