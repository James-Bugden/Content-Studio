import { describe, expect, it } from 'vitest';
import { contentTimestampParts, sameContentTimestamp, taipeiContentTimestamp } from '@/application/content-timestamps';
import { typedContentRow } from '@/application/content-import';
import { compareContent } from '@/application/content-parity';
import { contentPatch } from '@/integrations/supabase/content-repository';
import { FakeSheetTransport } from '@/integrations/google/fake-sheet';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';

const sample = (text: string, field = 'finalSyncedAt') => [{ cells: { [field]: text }, value: { contentId: 'SYN-STAMP', [field]: text } }];
const rolled = '2026-03-02T02:59:52+00:00';
const invalid = [
  '2026-02-30T02:59:52Z', '2026-02-29T02:59:52Z', '1900-02-29T02:59:52Z',
  '2026-04-31T02:59:52Z', '2026-06-31T02:59:52Z', '2026-09-31T02:59:52Z', '2026-11-31T02:59:52Z',
  '0000-01-01T00:00:00Z', '2026-00-21T02:59:52Z', '2026-13-21T02:59:52Z',
  '2026-09-00T02:59:52Z', '2026-09-32T02:59:52Z',
  '2026-09-21T25:00:00Z', '2026-09-21T24:01:00Z', '2026-09-21T24:00:01Z', '2026-09-21T24:00:00.000001Z',
  '2026-09-21T02:60:00Z', '2026-09-21T02:59:60Z',
  '2026-09-21T02:59:52+24:00', '2026-09-21T02:59:52-24:00',
  '2026-09-21T02:59:52+08:60', '2026-09-21T02:59:52-08:60',
  '2026-09-21T02:59:52', '2026-09-21 02:59:52Z', '2026-09-21T2:59:52Z',
];

describe('CS-075 calendar validation before timestamp equivalence and conversion', () => {
  it.each(invalid)('refuses %s without normalizing its calendar', async text => {
    const row = (await new SheetsContentRepository(new FakeSheetTransport()).listSchedule())[0]!;
    for (const field of ['finalSyncedAt', 'publishedAt', 'analyticsSyncedAt'] as const) {
      expect(contentTimestampParts(text, field)).toBeNull();
      expect(sameContentTimestamp(text, rolled, field)).toBe(false);
      expect(taipeiContentTimestamp(text)).toBeNull();
      const source = structuredClone(row);
      source.cells[field] = text;
      expect(() => typedContentRow('schedule', source.value.contentId, source)).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }));
      expect(() => contentPatch({ [field]: text })).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }));
    }
    expect(compareContent('schedule', sample(text), sample(rolled), 1, 0).blocking).toBe(2);
    // Invalid text remains exact text in parity, including two identical invalid cells.
    expect(compareContent('schedule', sample(text), sample(text), 1, 0).facts).toEqual([]);
  });

  it.each([
    ['0001-01-01T02:59:52Z', '0001-01-01T10:59:52+08:00'],
    ['9999-12-31T02:59:52Z', '9999-12-31T10:59:52+08:00'],
    ['2000-02-29T02:59:52Z', '2000-02-29T10:59:52+08:00'],
    ['2024-02-29T23:59:59Z', '2024-03-01T07:59:59+08:00'],
    ['2026-04-30T23:59:59Z', '2026-05-01T07:59:59+08:00'],
    ['2026-09-21T24:00Z', '2026-09-22T00:00:00Z'],
    ['2026-09-21T24:00:00.0000+08:00', '2026-09-21T16:00:00Z'],
    ['2026-09-21T10:59+08:00', '2026-09-21T02:59:00Z'],
    ['2026-09-21T23:59:59+23:59', '2026-09-21T00:00:59Z'],
    ['2026-09-21T00:00:00-23:59', '2026-09-21T23:59:00Z'],
  ])('accepts valid boundary %s', (left, right) => {
    expect(contentTimestampParts(left, 'finalSyncedAt')?.stamp).toBe(left);
    expect(sameContentTimestamp(left, right, 'finalSyncedAt')).toBe(true);
    const result = compareContent('schedule', sample(left), sample(right), 1, 0);
    expect(result.blocking).toBe(0);
    expect(result.equal).toBe(result.fields);
  });
});

describe('CS-075 parity equality is bounded to finalSyncedAt', () => {
  it.each(['publishedAt', 'analyticsSyncedAt'])('retains prior strict value comparison and unequal cell accounting for %s', field => {
    const left = '2026-09-21T10:59:52.1200+08:00', right = '2026-09-21T02:59:52.12Z';
    const result = compareContent('schedule', sample(left, field), sample(right, field), 1, 0);
    expect(result.blocking).toBe(1);
    expect(result.equal).toBe(result.fields - 2);
    expect(result.facts.map(f => [f.field, f.kind])).toEqual([
      [`cells.${field}`, 'timestamp_formatting'], [`value.${field}`, 'changed'],
    ]);
    // A cell-only comparison retains the old classified-but-unequal accounting.
    const cellsOnly = compareContent('schedule', [{ cells: { [field]: left }, value: { contentId: 'SYN-STAMP' } }],
      [{ cells: { [field]: right }, value: { contentId: 'SYN-STAMP' } }], 1, 0);
    expect(cellsOnly.blocking).toBe(0);
    expect(cellsOnly.equal).toBe(cellsOnly.fields - 1);
  });
});
