import { describe, expect, it, vi } from 'vitest';
import { compareContent, ContentParityJournal, PARITY_COLLECTIONS, shadowContentRepository } from '@/application/content-parity';
import { FakeSheetTransport } from '@/integrations/google/fake-sheet';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';
import { SupabaseContentRepository } from '@/integrations/supabase/content-repository';
import { FakeContentDb } from '@/integrations/supabase/fake-content-db';
import { recentEvents } from '@/observability/events';
import { buildReconcileReport } from '@/application/reconcile';
import { FakeDriveGateway } from '@/integrations/google/fake-drive';
import { contentLists, sheetWithIdlessRecords } from '../../support/idless-sheet';

const fullEvidence = { snapshotHash: 'a'.repeat(64), counts: { library: 0, queue: 0, schedule: 0, workflow_settings: 0 }, hashes: { library: 'a'.repeat(64), queue: 'a'.repeat(64), schedule: 'a'.repeat(64), workflow_settings: 'a'.repeat(64) }, exceptions: [], fullParity: { rows: 0, fields: 0, equal: 0, idsEqual: true, unclassified: 0 } };

describe('MIG-10 shadow comparisons', () => {
  it.each(contentLists)('CS-070: filters only Sheet-side idless records for %s without hiding duplicates', async (collection, method) => {
    const repo = await sheetWithIdlessRecords();
    const source = await repo[method]();
    const valid = source.filter(record => ('libraryId' in record.value ? record.value.libraryId : record.value.contentId).trim() !== '');
    const equal = compareContent(collection, source, valid, 1, 0);
    expect(equal).toMatchObject({ idsEqual: true, blocking: 0, facts: [] });
    expect(equal.fields).toBeGreaterThan(0);
    expect(equal.equal).toBe(equal.fields);
    expect(compareContent(collection, source.filter(r => !valid.some(record => record === r)), [], 1, 0)).toMatchObject({ idsEqual: true, blocking: 0 });
    for (const [left, right] of [[source, [...valid, valid[0]!]], [[...source, valid[0]!], valid]]) {
      expect(compareContent(collection, left, right, 1, 0)).toMatchObject({ idsEqual: false, blocking: 1 });
    }
    // A bad DB row must still fail the ID-set gate.
    expect(compareContent(collection, valid, source, 1, 0).idsEqual).toBe(false);
  });

  it('CS-070: leaves blank queue-summary sources and workflow-setting keys comparable', () => {
    expect(compareContent('queue_summary', [{ source: '', counts: { Total: 1 } }], [], 1, 0)).toMatchObject({ idsEqual: false, blocking: 1 });
    const settings = { raw: { '': 'Synthetic value' }, rawNotes: {}, timezone: 'Asia/Taipei', slots: [], problems: [] };
    expect(compareContent('workflow_settings', settings, { ...settings, raw: {} }, 1, 0)).toMatchObject({ idsEqual: false, blocking: 1 });
  });

  it('names blank checkbox equivalence without masking any other field or true checkbox', () => {
    const record = (posted: string, content: string) => [{ value: { contentId: 'SYN-1', posted: false }, cells: { posted, content } }];
    const equal = compareContent('schedule', record('', 'Synthetic copy'), record('FALSE', 'Synthetic copy'), 1, 0);
    expect(equal.equal).toBe(equal.fields); expect(equal.blocking).toBe(0);
    expect(equal.facts).toContainEqual(expect.objectContaining({ field: 'cells.posted', kind: 'blank_boolean' }));
    const changed = compareContent('schedule', record('', 'Synthetic copy '), record('FALSE', 'Synthetic copy'), 1, 0);
    expect(changed.blocking).toBe(1); expect(changed.equal).toBeLessThan(changed.fields);
    expect(compareContent('schedule', record('', ''), record('TRUE', ''), 1, 0).blocking).toBeGreaterThan(0);
  });
  it('detects unknown-column loss through the real DB reader', async () => {
    const db = new FakeContentDb();
    const row = (await db.listPosts('library'))[0]!;
    row.passthrough = { '34': { header: 'Synthetic extra', value: 'Synthetic text', formula: '', link: '' } };
    vi.spyOn(db, 'listPosts').mockResolvedValue([row]);
    const repo = new SupabaseContentRepository(db);
    const expected = await repo.listLibrary();
    expect(expected[0]?.passthrough).toEqual(row.passthrough);
    const lost = structuredClone(expected); lost[0]!.passthrough = {};
    const sample = compareContent('library', expected, lost, 1, 0);
    expect(sample.blocking).toBeGreaterThan(0);
    expect(sample.facts.some(f => f.field.startsWith('passthrough.'))).toBe(true);
  });
  it('keeps copy whitespace exact, narrowly classifies a terminal suffix, and still counts classified differences', async () => {
    const rows = await new SheetsContentRepository(new FakeSheetTransport()).listLibrary();
    const left = [structuredClone(rows[0]!)], right = structuredClone(left);
    left[0]!.cells.draftContent += '  \n';
    expect(compareContent('library', left, right, 1, 0).facts).toContainEqual(expect.objectContaining({ field: 'cells.draftContent', kind: 'changed' }));
    left[0]!.cells.draftContent = right[0]!.cells.draftContent;
    left[0]!.cells.nextAction = 'Synthetic action  \n'; right[0]!.cells.nextAction = 'Synthetic action';
    const sample = compareContent('library', left, right, 1, 0);
    expect(sample.facts).toContainEqual(expect.objectContaining({ field: 'cells.nextAction', kind: 'trailing_whitespace' }));
    expect(sample.equal).toBeLessThan(sample.fields);
    left[0]!.cells.nextAction = 'Synthetic action\n\n';
    expect(compareContent('library', left, right, 1, 0).blocking).toBeGreaterThan(0);
    left[0]!.cells.nextAction = 'Synthetic action\t';
    expect(compareContent('library', left, right, 1, 0).blocking).toBeGreaterThan(0);
  });
  it('treats measured empty-vs-empty as n/a while missing records and providers still fail', () => {
    const journal = new ContentParityJournal();
    journal.record(compareContent('ready', [], [], 1, 0));
    expect(journal.summary(1).collections.find(c => c.collection === 'ready')).toMatchObject({ fieldsNA: true, fieldEquality: 100, idsEqual: true });
    journal.record(compareContent('ready', [{ value: { libraryId: 'SYN-1' }, cells: {} }], [], 2, 0));
    expect(journal.summary(2).collections.find(c => c.collection === 'ready')).toMatchObject({ fieldsNA: false, fieldEquality: null, idsEqual: false });
    expect(journal.summary(2).ready).toBe(false);
    const green = new ContentParityJournal(), day = 86400_000, now = Date.UTC(2026, 9, 25);
    for (let d = 1; d <= 7; d++) for (const c of PARITY_COLLECTIONS) for (let n = 0; n < 5; n++) {
      green.record({ at: now - d * day + n, collection: c, idsEqual: true, fields: c === 'ready' ? 0 : 10, equal: c === 'ready' ? 0 : 10, blocking: 0, lagMs: 0, facts: [] });
    }
    green.imported(now); green.lastRun = fullEvidence;
    expect(green.summary(now)).toMatchObject({ ready: true, daysGreen: 7, sampleCount: 210 });
  });
  it('emits only one aggregate event per collection observation even for many differing fields', () => {
    const journal = new ContentParityJournal(), before = recentEvents().length;
    const sample = compareContent('library', [{ value: { libraryId: 'SYN-1' }, cells: { one: 'a', two: 'b' } }], [{ value: { libraryId: 'SYN-1' }, cells: { one: 'c', two: 'd' } }], 1, 0);
    expect(sample.facts.length).toBe(2);
    journal.record(sample);
    expect(recentEvents().length).toBe(before + 1);
    expect(recentEvents().at(-1)?.facts).toMatchObject({ collection: 'library', differences: 2, blocking: 2 });
  });
  it('uses the default ten-percent boundary and bounds a stalled comparison', async () => {
    const sheet = new SheetsContentRepository(new FakeSheetTransport()), db = new SupabaseContentRepository(new FakeContentDb()), journal = new ContentParityJournal();
    const random = vi.spyOn(Math, 'random').mockReturnValueOnce(.099).mockReturnValueOnce(.1);
    const read = vi.spyOn(db, 'listLibrary');
    const proxy = shadowContentRepository(sheet, db, journal);
    await proxy.listLibrary(); await proxy.listLibrary();
    expect(read).toHaveBeenCalledTimes(1); random.mockRestore();
    read.mockImplementationOnce(() => new Promise(() => {}));
    const start = performance.now();
    const result = await shadowContentRepository(sheet, db, journal, () => true).listLibrary();
    expect(performance.now() - start).toBeLessThan(1500);
    expect(result.length).toBeGreaterThan(0); expect(journal.samples.at(-1)?.blocking).toBe(1);
  });
  it('serves the same Sheet result with zero extra Sheet reads, samples only selected lists, and keeps writes on Sheet', async () => {
    const transport = new FakeSheetTransport(), sheet = new SheetsContentRepository(transport);
    const db = new SupabaseContentRepository(new FakeContentDb());
    const sheetRead = vi.spyOn(sheet, 'listLibrary'), dbRead = vi.spyOn(db, 'listLibrary');
    const result = await sheet.listLibrary(); sheetRead.mockClear();
    const journal = new ContentParityJournal();
    const read = vi.spyOn(transport, 'readTab');
    const proxy = shadowContentRepository(sheet, db, journal, () => true);
    expect(await proxy.listLibrary()).toEqual(result);
    expect(sheetRead).toHaveBeenCalledTimes(1); expect(dbRead).toHaveBeenCalledTimes(1);
    const calls = read.mock.calls.length; read.mockClear(); await sheet.listLibrary();
    expect(read.mock.calls.length).toBe(calls);
    await shadowContentRepository(sheet, db, journal, () => false).listLibrary();
    expect(dbRead).toHaveBeenCalledTimes(1);
    expect(proxy.updateLibrary).toBeTypeOf('function');
  });
  it('ignores Ready revision differences, reports real cell changes and names zero-row summary limitations', async () => {
    const rows = await new SheetsContentRepository(new FakeSheetTransport()).listReadyQueue();
    const changed = structuredClone(rows); changed[0]!.revision = '0000000000000000'; changed[0]!.formulaFields = [];
    expect(compareContent('ready', rows, changed, 1, 0).blocking).toBe(0);
    changed[0]!.cells.draftContent = 'Synthetic changed copy';
    const report = compareContent('ready', rows, changed, 1, 0);
    expect(report.blocking).toBeGreaterThan(0);
    expect(report.facts).toContainEqual(expect.objectContaining({ kind: 'changed', field: 'cells.draftContent' }));
    expect(JSON.stringify(report.facts)).not.toContain('Synthetic');
    const zero = compareContent('queue_summary', [{ source: 'Synthetic empty source', counts: { Total: 0 }, masterLink: '' }], [], 1, 0);
    expect(zero.idsEqual).toBe(false); expect(zero.facts[0]?.kind).toBe('zero_row_source');
  });
  it('records content-free facts, ID equality, percentages, samples, p95 and conservative days-green', () => {
    const journal = new ContentParityJournal(), day = 86400_000, now = Date.UTC(2026, 9, 25);
    expect(journal.summary(now)).toMatchObject({ sampleCount: 0, lagP95: null, daysGreen: 0, ready: false });
    for (let d = 1; d <= 7; d++) for (const c of PARITY_COLLECTIONS) for (let n = 0; n < 5; n++) {
      journal.record({ at: now - d * day + n, collection: c, idsEqual: true, fields: 1000, equal: 1000, blocking: 0, lagMs: 100, facts: [] });
    }
    journal.imported(now); journal.lastRun = fullEvidence;
    expect(journal.summary(now)).toMatchObject({ sampleCount: 210, daysGreen: 7, lagP95: 100, ready: true });
    journal.record({ at: now, collection: 'library', idsEqual: false, fields: 2, equal: 1, blocking: 1, lagMs: 1000,
      facts: [{ collection: 'library', field: 'cells.draftContent', kind: 'changed', fingerprint: '1234567890123456' }] });
    expect(journal.summary(now).ready).toBe(false);
    expect(journal.summary(now).collections[0]).toMatchObject({ idsEqual: false, blocking: 1 });
    const event = recentEvents().at(-1)!;
    expect(event.facts).toEqual({ collection: 'library', fields: 2, equal: 1, differences: 1, blocking: 1, idsEqual: false });
    expect(journal.summary(now + 2 * day).daysGreen).toBe(0);
  });
  it('DB failure never replaces the Sheet response and becomes a blocking measurement', async () => {
    const sheet = new SheetsContentRepository(new FakeSheetTransport()), db = new SupabaseContentRepository(new FakeContentDb());
    vi.spyOn(db, 'listLibrary').mockRejectedValue(new Error('Synthetic private provider details'));
    const journal = new ContentParityJournal();
    const result = await shadowContentRepository(sheet, db, journal, () => true).listLibrary();
    expect(result.length).toBeGreaterThan(0); expect(journal.summary().collections[0]?.blocking).toBe(1);
  });
  it('allows a recovered seven-day/200-request window but remembers failures unrepaired for over an hour', () => {
    const journal = new ContentParityJournal(), day = 86400_000, now = Date.UTC(2026, 9, 25);
    journal.record({ at: now - 10 * day, collection: 'library', idsEqual: false, fields: 1, equal: 0, blocking: 1, lagMs: 0, facts: [] });
    for (let d = 1; d <= 7; d++) for (const c of PARITY_COLLECTIONS) for (let n = 0; n < 5; n++) journal.record({ at: now - d * day + n, collection: c, idsEqual: true, fields: 100, equal: 100, blocking: 0, lagMs: 100, facts: [] });
    journal.imported(now); journal.lastRun = fullEvidence;
    expect(journal.summary(now)).toMatchObject({ ready: true, daysGreen: 7, sampleCount: 210 });
    journal.failed(now - 7200_000); journal.imported(now); journal.lastRun = fullEvidence;
    expect(journal.summary(now).ready).toBe(false);
  });
  it('shows unknown/15-minute/60-minute import lag and blocking differences in reconcile', async () => {
    const repo = new SheetsContentRepository(new FakeSheetTransport()), journal = new ContentParityJournal();
    const build = (now: number) => buildReconcileReport(repo, new FakeDriveGateway(), now, { contentParity: journal });
    expect((await build(0)).items).toContainEqual(expect.objectContaining({ kind: 'import_lag', severity: 'blocking' }));
    journal.imported(0);
    expect((await build(900_000)).items).toContainEqual(expect.objectContaining({ kind: 'import_lag', severity: 'attention' }));
    expect((await build(3600_000)).items).toContainEqual(expect.objectContaining({ kind: 'import_lag', severity: 'blocking' }));
    journal.record({ at: 3600_000, collection: 'library', idsEqual: true, fields: 1, equal: 0, blocking: 1, lagMs: 3600_000, facts: [] });
    expect((await build(3600_000)).items).toContainEqual(expect.objectContaining({ kind: 'content_parity', severity: 'blocking' }));
  });
});
