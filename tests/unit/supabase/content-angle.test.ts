import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyRefusal, runTypedImport, typedContentRow } from '@/application/content-import';
import { ContentExporter, ContentWriteCutover, contentExportRows } from '@/application/content-export';
import { compareContent } from '@/application/content-parity';
import { mirrorHash } from '@/application/sheet-mirror';
import { CONTENT_ANGLE_RAW_KEY, numberedContentAngle } from '@/domain/content-angle';
import { LIBRARY_HEADERS, SHEET_TABS } from '@/domain/sheet-schema';
import { FakeSheetTransport } from '@/integrations/google/fake-sheet';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';
import { FakeContentImportStore } from '@/integrations/supabase/fake-content-import';
import { SupabaseContentRepository } from '@/integrations/supabase/content-repository';
import { setTelemetrySink } from '@/observability/events';

const telemetry = vi.fn();
beforeEach(() => { vi.stubEnv('CS_CONTENT_STORE', 'db-shadow'); telemetry.mockClear(); setTelemetrySink(telemetry); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); setTelemetrySink(null); });
const actor = mirrorHash('synthetic-angle-actor');
function fixture(text: string, kind: 'library' | 'queue' = 'library') {
  const sheet = new FakeSheetTransport(), tab = SHEET_TABS[kind].name;
  const grid = sheet.rawTab(tab), column = grid[0]!.findIndex(c => c.value === LIBRARY_HEADERS.contentAngle);
  sheet.externalEdit(tab, 2, column, text);
  // Retain a real unknown column beside the internal raw-cell metadata.
  grid[0]!.push({ value: 'Synthetic extra' });
  grid[1]!.push({ value: 'Synthetic extra text  ' });
  const repo = new SheetsContentRepository(sheet);
  const store = new FakeContentImportStore({ posts: [], schedule: [], settings: [] });
  return { sheet, repo, store, tab, column };
}

describe('CS-072 numbered Content Angle cells', () => {
  it.each(Array.from({ length: 14 }, (_, i) => i + 1))('imports and renders label %i exactly without changing Sheet mapping', async angle => {
    const text = ` \t${String(angle).padStart(2, '0')}.\tExample angle \u81fa  `;
    const { repo, store } = fixture(text);
    const source = (await repo.listLibrary())[0]!;
    const before = structuredClone(source);
    const typed = typedContentRow('library', source.value.libraryId, source);
    expect(typed.content_angle).toBe(angle);
    expect(typed.passthrough).toEqual({ ...source.passthrough, [CONTENT_ANGLE_RAW_KEY]: text });
    expect(source).toEqual(before);
    expect(source.value.contentAngle).toBeNull(); // Sheet mode's num() is unchanged.
    const result = await runTypedImport(repo, store, 'synthetic_workbook', actor);
    expect(result.exceptions.filter(e => e.field === 'content_angle' || e.class.startsWith('refused_'))).toEqual([]);
    const actual = await new SupabaseContentRepository(store.db).getLibrary(source.value.libraryId);
    expect(actual.cells.contentAngle).toBe(text);
    expect(actual.passthrough).toEqual(source.passthrough);
    expect(actual.value).toEqual(source.value);
    expect((await contentExportRows(store.db)).find(r => r.id === source.value.libraryId)?.cells[LIBRARY_HEADERS.contentAngle]).toEqual({ value: text });
    expect(await store.db.getPost('library', source.value.libraryId)).toMatchObject({ content_angle: angle, passthrough: { [CONTENT_ANGLE_RAW_KEY]: text } });
    expect(JSON.stringify(telemetry.mock.calls)).not.toContain('Example angle');
  });

  it.each(['1.Example angle', '14. Example angle', '\n3. Example angle  ', '3.5'])('accepts the exact specified grammar: %j', text => {
    expect(numberedContentAngle(text)).not.toBeNull();
  });

  it.each(['0. Example angle', '15. Example angle', 'x. y', '7 Example angle', '7.', '7.   ', '-3. Example angle', '003. Example angle', '3. Example\nangle', 'Example 3. angle', '3e0. Example angle'])('refuses invalid label %j with content-free diagnostics', async text => {
    const { repo, store } = fixture(text);
    const records = await repo.listLibrary(), source = records[0]!;
    let error: unknown;
    try { typedContentRow('library', source.value.libraryId, source); } catch (caught) { error = caught; }
    expect(error).toMatchObject({ code: 'VALIDATION_FAILED', details: { reason: 'copy_numeric', field: 'content_angle' } });
    expect(copyRefusal(error)).toEqual({ class: 'refused_numeric', field: 'content_angle' });
    expect(JSON.stringify(error)).not.toContain(text);
    const result = await runTypedImport(repo, store, 'synthetic_workbook', actor);
    expect(result.counts.library).toBe(records.length - 1);
    expect(result.exceptions.filter(e => e.class.startsWith('refused_'))).toEqual([{ class: 'refused_numeric', collection: 'library', field: 'content_angle', hash: expect.stringMatching(/^[a-f0-9]{64}$/) }]);
    expect(JSON.stringify(result.exceptions)).not.toContain(text);
    expect(await store.db.getPost('library', source.value.libraryId)).toBeNull();
    // Short invalid cells such as "7." can occur coincidentally in a clock
    // timestamp. Check every content-bearing event field, excluding the clock.
    expect(JSON.stringify(telemetry.mock.calls.map(([event]) => ({ ...event, at: '' })))).not.toContain(text);
  });

  it.each(['3', '', '0', '15'])('keeps existing plain numeric/blank rules for %j', async text => {
    const { repo, store } = fixture(text);
    await runTypedImport(repo, store, 'synthetic_workbook', actor);
    const source = (await repo.listLibrary())[0]!, row = (await store.db.getPost('library', source.value.libraryId))!;
    expect(row.content_angle).toBe(text ? Number(text) : null);
    expect(row.passthrough).toEqual(source.passthrough);
    expect((await contentExportRows(store.db)).find(r => r.id === source.value.libraryId)?.cells[LIBRARY_HEADERS.contentAngle]?.value).toBe(text);
  });

  it('does not broaden any other numeric rule or expose copy in exceptions', async () => {
    const { repo } = fixture('3. Example angle');
    const library = (await repo.listLibrary())[0]!, schedule = (await repo.listSchedule())[0]!;
    for (const field of ['hookScore', 'views', 'likes', 'reposts', 'replies', 'bookmarks', 'newFollowers']) {
      const record = structuredClone(field === 'hookScore' ? library : schedule);
      Object.assign(record.cells, { [field]: '3. Example angle' });
      expect(() => typedContentRow(field === 'hookScore' ? 'library' : 'schedule', 'libraryId' in record.value ? record.value.libraryId : record.value.contentId, record))
        .toThrowError(expect.objectContaining({ details: { reason: 'copy_numeric', field: field === 'hookScore' ? 'hook_score' : field === 'newFollowers' ? 'new_followers' : field } }));
    }
  });

  it.each(['library', 'queue'] as const)('exports and rehearses rollback byte-for-byte for %s; a DB edit cannot resurrect another angle label', async kind => {
    const text = ' \t3. Example angle \u81fa  ', { sheet, repo, store, tab, column } = fixture(text, kind);
    await runTypedImport(repo, store, 'synthetic_workbook', actor);
    const dbRepo = new SupabaseContentRepository(store.db), exporter = new ContentExporter(store.db, sheet, { checkpoints: new Map(), issues: new Map(), reports: [] });
    const cutover = new ContentWriteCutover(dbRepo, exporter);
    const before = sheet.rawTab(tab).map(row => row[column]?.value ?? '');
    const flip = vi.fn();
    const result = await cutover.rollbackToSheet(flip);
    expect(result.parity).toMatchObject({ exact: true, dbHash: result.parity.sheetHash });
    expect(flip).toHaveBeenCalledWith('sheet');
    expect(Buffer.from(JSON.stringify(sheet.rawTab(tab).map(row => row[column]?.value ?? '')))).toEqual(Buffer.from(JSON.stringify(before)));
    expect(sheet.writes.flatMap(w => w.writes.filter(c => w.tab === tab && c.column === column))).toEqual([]);
    const source = (await (kind === 'library' ? repo.listLibrary() : repo.listQueue()))[0]!;
    for (const angle of [4, null]) {
      store.db.externalEdit(kind, source.value.libraryId, { content_angle: angle });
      expect((await exporter.run()).exact).toBe(true);
      expect(sheet.rawTab(tab)[1]![column]!.value).toBe(angle === null ? '' : String(angle));
      expect((await dbRepo[kind === 'library' ? 'getLibrary' : 'getQueue'](source.value.libraryId)).cells.contentAngle).toBe(angle === null ? '' : String(angle));
    }
  });

  it('parity requires exact label bytes and excludes internal metadata while retaining unknown columns', async () => {
    const { repo, store } = fixture('3. Example angle  ');
    await runTypedImport(repo, store, 'synthetic_workbook', actor);
    const expected = await repo.listLibrary(), actual = await new SupabaseContentRepository(store.db).listLibrary();
    expect(compareContent('library', expected, actual, 1, 0)).toMatchObject({ idsEqual: true, blocking: 0, facts: [] });
    for (const text of ['3. Example angle', '3. Different example angle  ', '3']) {
      const changed = structuredClone(actual); changed[0]!.cells.contentAngle = text;
      const report = compareContent('library', expected, changed, 1, 0);
      expect(report.blocking).toBeGreaterThan(0);
      expect(report.facts).toContainEqual(expect.objectContaining({ field: 'cells.contentAngle', kind: 'changed' }));
      expect(JSON.stringify(report)).not.toContain('Example angle');
    }
  });

  it.each([{}, null, 3, '3', ['3. Example angle'], '0. Example angle', '15. Example angle', 'x. y'].map(metadata => ({ metadata })))('ignores malformed preserved metadata $metadata, even for a null DB angle', async ({ metadata }) => {
    const { repo, store } = fixture('3. Example angle');
    await runTypedImport(repo, store, 'synthetic_workbook', actor);
    const source = (await repo.listLibrary())[0]!, row = (await store.db.getPost('library', source.value.libraryId))!;
    for (const angle of [3, null]) {
      store.db.externalEdit('library', source.value.libraryId, { content_angle: angle, passthrough: { ...row.passthrough, [CONTENT_ANGLE_RAW_KEY]: metadata } });
      expect((await new SupabaseContentRepository(store.db).getLibrary(source.value.libraryId)).cells.contentAngle).toBe(angle === null ? '' : '3');
      expect((await contentExportRows(store.db)).find(r => r.id === source.value.libraryId)?.cells[LIBRARY_HEADERS.contentAngle]?.value).toBe(angle === null ? '' : '3');
    }
  });
});
