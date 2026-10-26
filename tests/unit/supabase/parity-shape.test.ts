import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyDifference, buildTypedImport, typedContentRow } from '@/application/content-import';
import { compareContent } from '@/application/content-parity';
import { buildSheetMirrorSnapshot, mirrorHash } from '@/application/sheet-mirror';
import { isReadyQueuePlaceholder } from '@/application/sheet-records';
import { deriveQueueSummary } from '@/application/queue-summary';
import { toLibraryRecord } from '@/domain/mapping';
import { LIBRARY_HEADERS, SHEET_TABS, discoverHeaders } from '@/domain/sheet-schema';
import { FakeSheetTransport } from '@/integrations/google/fake-sheet';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';
import { SnapshotContentRepository } from '@/integrations/supabase/snapshot-content-repository';

beforeEach(() => vi.stubEnv('CS_CONTENT_STORE', 'db-shadow'));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

function library(cells: Record<string, string>) {
  const headers = Object.values(LIBRARY_HEADERS), found = discoverHeaders(LIBRARY_HEADERS, headers);
  if (!found.ok) throw new Error('Synthetic headers');
  return toLibraryRecord(found.index, { values: Object.keys(LIBRARY_HEADERS).map(field => cells[field] ?? '') }, 2);
}

describe('CS-075 schedule timestamp equivalence', () => {
  it.each(['finalSyncedAt', 'publishedAt', 'analyticsSyncedAt'] as const)('compares both cells and value.%s by instant with exact hash', async field => {
    const source = (await new SheetsContentRepository(new FakeSheetTransport()).listSchedule()).slice(0, 1);
    for (const [left, right] of [
      ['2026-09-21T10:59:52+08:00', '2026-09-21T02:59:52.000Z'],
      ['2026-09-21T10:59:52.1200+08:00', '2026-09-20T22:59:52.12-04:00'],
      ['2026-09-21T10:59:52.123456+08:00', '2026-09-21T02:59:52.123456Z'],
      ['2026-09-21T10:59+08:00', '2026-09-21T02:59:00Z'],
    ]) {
      const expected = structuredClone(source), actual = structuredClone(source);
      const suffix = field === 'finalSyncedAt' ? ' #synthetic-exact-hash' : '';
      expected[0]!.cells[field] = expected[0]!.value[field] = left + suffix;
      actual[0]!.cells[field] = actual[0]!.value[field] = right + suffix;
      expect(classifyDifference(left + suffix, right + suffix, field)).toBe('timestamp_formatting');
      const sample = compareContent('schedule', expected, actual, 100, 0);
      expect(sample).toMatchObject({ idsEqual: true, blocking: 0 });
      expect(sample.equal).toBe(sample.fields);
      expect(sample.facts.map(f => [f.field, f.kind])).toEqual([
        [`cells.${field}`, 'timestamp_formatting'], [`value.${field}`, 'timestamp_formatting'],
      ]);
      actual[0]!.cells[field] = actual[0]!.value[field] = '2026-09-21T02:59:53Z' + suffix;
      expect(compareContent('schedule', expected, actual, 100, 0).blocking).toBe(2);
      const row = typedContentRow('schedule', expected[0]!.value.contentId, expected[0]!);
      expect(row[field.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`)]).toBe(left);
      if (field === 'finalSyncedAt') expect(row.final_synced_hash).toBe('synthetic-exact-hash');
    }
  });

  it.each([
    ['2026-09-21T02:59:52.123001Z', '2026-09-21T02:59:52.123002Z', 'finalSyncedAt'],
    ['2026-09-21T02:59:52Z #a', '2026-09-21T10:59:52+08:00 #b', 'finalSyncedAt'],
    ['2026-09-21T02:59:52Z #\uFF21', '2026-09-21T10:59:52+08:00 #A', 'finalSyncedAt'],
    ['2026-09-21T02:59:52Z #Cafe\u0301', '2026-09-21T10:59:52+08:00 #Caf\u00e9', 'finalSyncedAt'],
    ['2026-09-21T02:59:52Z #a\t', '2026-09-21T10:59:52+08:00 #a', 'finalSyncedAt'],
    ['2026-09-21T02:59:52Z #a', '2026-09-21T10:59:52+08:00', 'finalSyncedAt'],
    ['2026-09-21T02:59:52Z #', '2026-09-21T10:59:52+08:00', 'finalSyncedAt'],
    ['2026-09-21T02:59:52Z #a #b', '2026-09-21T10:59:52+08:00 #a #b', 'finalSyncedAt'],
    ['2026-09-21T02:59:52', '2026-09-21T10:59:52+08:00', 'finalSyncedAt'],
    ['invalid', 'also invalid', 'finalSyncedAt'],
    ['2026-09-21T02:59:52Z #a', '2026-09-21T10:59:52+08:00 #a', 'publishedAt'],
    ['2026-09-21T02:59:52Z', '2026-09-21T10:59:52+08:00', 'content'],
  ])('refuses non-equivalent or non-timestamp text %s / %s', (left, right, field) => {
    expect(classifyDifference(left, right, field)).toBeNull();
  });

  it.each(['invalid', '2026-09-21T02:59:52', '2026-99-21T02:59:52Z', ' #hash',
    '2026-09-21T02:59:52Z #', '2026-09-21T02:59:52Z #a #b'])('refuses invalid timestamp imports: %s', async text => {
    const record = (await new SheetsContentRepository(new FakeSheetTransport()).listSchedule())[0]!;
    record.cells.finalSyncedAt = text;
    expect(() => typedContentRow('schedule', record.value.contentId, record)).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }));
  });

  it('keeps timestamp-looking content bytes exact', () => {
    const record = (content: string) => [{ value: { contentId: 'SYN-1', content }, cells: { content } }];
    expect(compareContent('schedule', record('2026-09-21T02:59:52Z'), record('2026-09-21T10:59:52+08:00'), 1, 0).blocking).toBe(2);
  });
});

describe('CS-075 Ready Queue placeholder', () => {
  it('skips the exact sentinel in the adapter, mirror/import snapshot, parity and counts', async () => {
    const placeholder = library({ libraryId: 'No posts queued' });
    expect(isReadyQueuePlaceholder(placeholder)).toBe(true);
    const transport = new FakeSheetTransport({ [SHEET_TABS.readyQueue.name]: [
      { values: Object.values(LIBRARY_HEADERS) }, { values: ['No posts queued'] },
    ] });
    const repo = new SheetsContentRepository(transport);
    expect(await repo.listReadyQueue()).toEqual([]);
    // Exercise downstream guards independently of adapter filtering.
    vi.spyOn(repo, 'listReadyQueue').mockResolvedValue([placeholder]);
    const snapshot = await buildSheetMirrorSnapshot(repo, { sourceKey: 'synthetic_workbook' });
    expect(snapshot.counts.ready).toBe(0);
    expect(snapshot.rows.some(r => r.stableId === 'No posts queued')).toBe(false);
    expect(buildTypedImport(snapshot, new Map(), mirrorHash('synthetic')).rows.some(r => r.target_id === 'No posts queued')).toBe(false);
    expect(compareContent('ready', [placeholder], [], 1, 0)).toMatchObject({ idsEqual: true, fields: 0, blocking: 0 });
    // A malformed DB-side sentinel must still fail closed.
    expect(compareContent('ready', [], [placeholder], 1, 0)).toMatchObject({ idsEqual: false, blocking: 1 });
    for (const collection of ['library', 'queue'] as const) expect(compareContent(collection, [placeholder], [], 1, 0).blocking).toBe(1);
  });

  it('preserves similar IDs, any nonblank field/link/extra cell and real rows', async () => {
    const placeholder = library({ libraryId: 'No posts queued' });
    const rows = [library({ libraryId: 'No posts queued ' }), library({ libraryId: 'No posts queued soon' }),
      library({ libraryId: 'No posts queued', draftContent: '\t' }), library({ libraryId: 'SYN-1' }),
      { ...placeholder, links: { sourceMarkdown: 'https://synthetic.example/md' } },
      ...['value', 'formula', 'link'].map(key => ({ ...placeholder, passthrough: { '33': { header: 'Extra', [key]: 'x' } } })),
      { ...placeholder, passthrough: { '33': 'x' } }];
    for (const record of rows) {
      expect(isReadyQueuePlaceholder(record)).toBe(false);
      expect(compareContent('ready', [record], [], 1, 0).blocking).toBe(1);
    }
    const repo = new SheetsContentRepository(new FakeSheetTransport());
    vi.spyOn(repo, 'listReadyQueue').mockResolvedValue([placeholder, rows[1]!]);
    const snapshot = await buildSheetMirrorSnapshot(repo, { sourceKey: 'synthetic_workbook' });
    expect(snapshot.counts.ready).toBe(1);
    expect(snapshot.rows.find(r => r.collection === 'ready')?.stableId).toBe('No posts queued soon');
    expect(isReadyQueuePlaceholder({ ...placeholder, links: { sourceMarkdown: '' }, passthrough: { '33': { header: 'Extra', value: '', formula: '', link: '' } } })).toBe(true);
    vi.spyOn(repo, 'listLibrary').mockResolvedValue([placeholder]);
    vi.spyOn(repo, 'listQueue').mockResolvedValue([placeholder]);
    const otherCollections = await buildSheetMirrorSnapshot(repo, { sourceKey: 'synthetic_workbook' });
    expect(otherCollections.counts.library).toBe(1);
    expect(otherCollections.counts.queue).toBe(1);
  });
});

describe('CS-075 derived queue summary exact text', () => {
  it('round-trips blank, whitespace and trim-colliding source groups through the mirror reader', async () => {
    const repo = new SheetsContentRepository(new FakeSheetTransport());
    const sources = ['', ' ', 'A', ' A '];
    const summary = deriveQueueSummary(sources.map((contentSource, i) => library({ libraryId: `SYN-${i}`, contentSource })));
    vi.spyOn(repo, 'queueSummary').mockResolvedValue(summary);
    const snapshot = await buildSheetMirrorSnapshot(repo, { sourceKey: 'synthetic_workbook' });
    expect(snapshot.counts.queue_summary).toBe(4);
    expect(await new SnapshotContentRepository(snapshot.rows).queueSummary()).toEqual(summary);
    const broken = structuredClone(snapshot.rows);
    (broken.find(r => r.collection === 'queue_summary')!.payload as { source: unknown }).source = 123;
    await expect(new SnapshotContentRepository(broken).queueSummary()).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });

  it('keeps source bytes and exact SQL status spelling instead of normalized domain enums', () => {
    const rows = [library({ libraryId: 'SYN-1', contentSource: 'Cafe\u0301', reviewStatus: 'Approved ', queueForSchedule: 'yes', copyrightQa: ' REWORK' }),
      library({ libraryId: 'SYN-2', contentSource: 'Caf\u00e9', reviewStatus: 'Pending', duplicateQa: 'CHECK' }),
      library({ libraryId: 'SYN-3', contentSource: '\uFF21', reviewStatus: 'Changes Requested', duplicateQa: 'DUPLICATE', copyrightQa: 'REWORK' }),
      library({ libraryId: 'SYN-4', contentSource: 'A\t' }), library({ libraryId: 'SYN-5', contentSource: 'A' }),
      library({ libraryId: ' ', contentSource: 'Excluded' })];
    const summary = deriveQueueSummary(rows);
    expect(summary).toHaveLength(5);
    expect(summary.find(r => r.source === 'Cafe\u0301')?.counts).toEqual({ Total: 1, Approved: 0, Queued: 1, 'Not Reviewed': 0, 'Needs Fix': 0 });
    expect(summary.find(r => r.source === '\uFF21')?.counts['Needs Fix']).toBe(1);
    for (const changed of ['Cafe\u0301', '\uFF21', 'A\t']) {
      const actual = structuredClone(summary);
      actual.find(r => r.source === changed)!.source = changed.normalize('NFKC').replace(/\t/g, '');
      expect(compareContent('queue_summary', summary, actual, 1, 0).blocking).toBeGreaterThan(0);
    }
  });
});
