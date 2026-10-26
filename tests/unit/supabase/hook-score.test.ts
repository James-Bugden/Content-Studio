import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyRefusal, runTypedImport, typedContentRow, classifyDifference } from '@/application/content-import';
import { ContentExporter, ContentWriteCutover, contentExportRows } from '@/application/content-export';
import { compareContent } from '@/application/content-parity';
import { mirrorHash } from '@/application/sheet-mirror';
import { CONTENT_ANGLE_RAW_KEY } from '@/domain/content-angle';
import { HOOK_SCORE_RAW_KEY, decimalHookScore } from '@/domain/hook-score';
import { LIBRARY_HEADERS } from '@/domain/sheet-schema';
import { FakeContentImportStore } from '@/integrations/supabase/fake-content-import';
import { SupabaseContentRepository, contentPatch } from '@/integrations/supabase/content-repository';
import { setTelemetrySink } from '@/observability/events';
import { acceptedScores, refusedScores, scoreFixture, scoreKinds, scoreMethod } from '../../support/hook-score';

const actor = mirrorHash('synthetic-score-actor'), telemetry = vi.fn();
beforeEach(() => { vi.stubEnv('CS_CONTENT_STORE', 'db-shadow'); setTelemetrySink(telemetry); telemetry.mockClear(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); setTelemetrySink(null); });

describe('CS-074 decimal Hook Score exact Sheet round-trip', () => {
  it.each(scoreKinds.flatMap(kind => acceptedScores.map(text => ({ kind, text }))))('$kind accepts $text and preserves every original byte through export, parity and rollback', async ({ kind, text }) => {
    const { repo, sheet, tab, grid, column, row } = scoreFixture(text, kind);
    const source = (await repo[scoreMethod(kind)]())[0]!, id = 'libraryId' in source.value ? source.value.libraryId : source.value.contentId;
    const before = structuredClone(source), typed = typedContentRow(kind, id, source);
    expect(typed.hook_score).toBe(Number(text.trim()));
    expect(typed.passthrough).toMatchObject({ ...source.passthrough, [HOOK_SCORE_RAW_KEY]: text });
    if (kind !== 'schedule') expect(typed.passthrough).toHaveProperty(CONTENT_ANGLE_RAW_KEY, '7. Cafe\u0301\t');
    // Field order cannot make either metadata entry overwrite the other.
    const reversed = { ...source, cells: Object.fromEntries(Object.entries(source.cells).reverse()) } as typeof source;
    expect(typedContentRow(kind, id, reversed).passthrough).toEqual(typed.passthrough);
    expect(source).toEqual(before);
    expect(source.value.hookScore).toBe(Number(text.trim()));
    const store = new FakeContentImportStore({ posts: [], schedule: [], settings: [] });
    const imported = await runTypedImport(repo, store, 'synthetic_workbook', actor);
    expect(imported.exceptions.filter(e => e.field === 'hook_score' || e.class.startsWith('refused_'))).toEqual([]);
    const dbRepo = new SupabaseContentRepository(store.db), actual = await dbRepo[scoreMethod(kind)]();
    const importedRecord = actual.find(r => ('libraryId' in r.value ? r.value.libraryId : r.value.contentId) === id)!;
    expect(importedRecord.cells.hookScore).toBe(text);
    expect(importedRecord.value.hookScore).toBe(Number(text.trim()));
    expect(importedRecord.passthrough).toEqual(source.passthrough);
    expect(compareContent(kind, await repo[scoreMethod(kind)](), actual, 1, 0)).toMatchObject({ idsEqual: true, blocking: 0, facts: [] });
    const exported = (await contentExportRows(store.db)).find(r => r.kind === kind && r.id === id)!;
    expect(Buffer.from(exported.cells[LIBRARY_HEADERS.hookScore]!.value)).toEqual(Buffer.from(text));
    const exact = Buffer.from(JSON.stringify(grid));
    const exporter = new ContentExporter(store.db, sheet, { checkpoints: new Map(), issues: new Map(), reports: [] });
    expect((await new ContentWriteCutover(dbRepo, exporter).rollbackToSheet(vi.fn())).parity.exact).toBe(true);
    expect(Buffer.from(JSON.stringify(grid))).toEqual(exact);
    expect(sheet.writes.flatMap(w => w.writes.filter(c => w.tab === tab && c.row === row && c.column === column))).toEqual([]);
    for (const score of [5.25, null]) {
      store.db.externalEdit(kind, id, { hook_score: score });
      expect((await exporter.run()).exact).toBe(true);
      expect(grid[row - 1]![column]!.value).toBe(score === null ? '' : String(score));
      expect((await dbRepo[scoreMethod(kind)]()).find(r => ('libraryId' in r.value ? r.value.libraryId : r.value.contentId) === id)!.cells.hookScore).toBe(score === null ? '' : String(score));
    }
    expect(JSON.stringify(telemetry.mock.calls)).not.toContain('Synthetic Cafe');
  });

  it.each(scoreKinds.flatMap(kind => refusedScores.map(text => ({ kind, text }))))('$kind refuses $text with content-free diagnostics', async ({ kind, text }) => {
    const { repo } = scoreFixture(text, kind), source = (await repo[scoreMethod(kind)]())[0]!;
    const id = 'libraryId' in source.value ? source.value.libraryId : source.value.contentId;
    let error: unknown;
    try { typedContentRow(kind, id, source); } catch (e) { error = e; }
    expect(copyRefusal(error)).toEqual({ class: 'refused_numeric', field: 'hook_score' });
    expect(JSON.stringify(error)).not.toContain(text);
    expect(source.value.hookScore).toBeNull();
    const store = new FakeContentImportStore({ posts: [], schedule: [], settings: [] });
    const result = await runTypedImport(repo, store, 'synthetic_workbook', actor);
    expect(result.counts[kind]).toBe((await repo[scoreMethod(kind)]()).length - 1);
    expect(result.exceptions.filter(e => e.class.startsWith('refused_'))).toEqual([{ class: 'refused_numeric', field: 'hook_score', collection: kind, hash: expect.stringMatching(/^[a-f0-9]{64}$/) }]);
    expect(await (kind === 'schedule' ? store.db.getSchedule(id) : store.db.getPost(kind, id))).toBeNull();
    expect(JSON.stringify(result.exceptions.map(e => ({ ...e, hash: '' })))).not.toContain(text);
  });

  it.each(scoreKinds)('%s ignores invalid preserved metadata, including for a null DB value; legacy integers still render', async kind => {
    const { repo } = scoreFixture('6.0', kind), store = new FakeContentImportStore({ posts: [], schedule: [], settings: [] });
    await runTypedImport(repo, store, 'synthetic_workbook', actor);
    const source = (await repo[scoreMethod(kind)]())[0]!, id = 'libraryId' in source.value ? source.value.libraryId : source.value.contentId;
    const stored = (await (kind === 'schedule' ? store.db.getSchedule(id) : store.db.getPost(kind, id)))!;
    for (const metadata of [{}, null, 6, ['6.0'], ...refusedScores]) for (const score of [6, null]) {
      store.db.externalEdit(kind, id, { hook_score: score, passthrough: { ...stored.passthrough, [HOOK_SCORE_RAW_KEY]: metadata } });
      const actual = (await new SupabaseContentRepository(store.db)[scoreMethod(kind)]()).find(r => ('libraryId' in r.value ? r.value.libraryId : r.value.contentId) === id)!;
      expect(actual.cells.hookScore).toBe(score === null ? '' : '6');
      expect(actual.passthrough).toEqual(source.passthrough);
      expect((await contentExportRows(store.db)).find(r => r.kind === kind && r.id === id)!.cells[LIBRARY_HEADERS.hookScore]!.value).toBe(score === null ? '' : '6');
    }
    store.db.externalEdit(kind, id, { hook_score: 6, passthrough: source.passthrough });
    expect((await new SupabaseContentRepository(store.db)[scoreMethod(kind)]()).find(r => ('libraryId' in r.value ? r.value.libraryId : r.value.contentId) === id)!.cells.hookScore).toBe('6');
  });

  it.each(scoreKinds)('%s exact parity rejects normalization and whitespace loss', async kind => {
    for (const [text, changed] of [['6.0', '6'], ['7.50', '7.5'], ['006', '6'], ['6.5\u00a0', '6.5'], ['6.5\t', '6.5']]) {
      const { repo } = scoreFixture(text!, kind), store = new FakeContentImportStore({ posts: [], schedule: [], settings: [] });
      await runTypedImport(repo, store, 'synthetic_workbook', actor);
      const actual = await new SupabaseContentRepository(store.db)[scoreMethod(kind)](); actual[0]!.cells.hookScore = changed!;
      const report = compareContent(kind, await repo[scoreMethod(kind)](), actual, 1, 0);
      expect(report.blocking).toBeGreaterThan(0);
      expect(report.facts).toContainEqual(expect.objectContaining({ field: 'cells.hookScore', kind: 'changed' }));
      expect(classifyDifference(text, changed, 'hookScore')).toBeNull();
    }
  });

  it('changes only Hook Score numeric validation for imports, patches and persisted reads', async () => {
    for (const text of acceptedScores) expect(contentPatch({ hookScore: text })).toEqual({ hook_score: Number(text.trim()) });
    expect(contentPatch({ hookScore: '' })).toEqual({ hook_score: null });
    expect(decimalHookScore('')).toBeNull();
    for (const text of refusedScores) expect(() => contentPatch({ hookScore: text })).toThrowError(expect.objectContaining({ details: { reason: 'value_invalid', field: 'hookScore' } }));
    const { repo } = scoreFixture('6.5'), source = (await repo.listLibrary())[0]!, schedule = (await repo.listSchedule())[0]!;
    for (const field of ['contentAngle', 'views', 'likes', 'reposts', 'replies', 'bookmarks', 'newFollowers']) {
      const record = structuredClone(field === 'contentAngle' ? source : schedule);
      Object.assign(record.cells, { [field]: '6.55' }); // contentAngle's existing N.Name grammar remains unchanged.
      if (field === 'contentAngle') record.cells = { ...record.cells, contentAngle: '.55' } as typeof record.cells;
      expect(() => typedContentRow(field === 'contentAngle' ? 'library' : 'schedule', 'libraryId' in record.value ? record.value.libraryId : record.value.contentId, record)).toThrow();
      expect(() => contentPatch({ [field]: '6.5' })).toThrow();
    }
    const store = new FakeContentImportStore({ posts: [], schedule: [], settings: [] });
    await runTypedImport(repo, store, 'synthetic_workbook', actor);
    for (const score of [6.555, 1000, Infinity, NaN]) {
      store.db.externalEdit('library', source.value.libraryId, { hook_score: score });
      await expect(new SupabaseContentRepository(store.db).getLibrary(source.value.libraryId)).rejects.toMatchObject({ code: 'SCHEMA_DRIFT' });
    }
  });
});
