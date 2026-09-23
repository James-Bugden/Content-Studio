import { describe, expect, it } from 'vitest';
import { textSimilarity, similarityTokens } from '@/domain/similarity';
import { formatSyncStamp, parseSyncStamp, plannedTaipeiIso, sameInstant, toTaipeiIso, finalTextHash } from '@/domain/typefully';
import { publishedSummary } from '@/domain/analytics';
import { FakeSheetTransport } from '@/integrations/google/fake-sheet';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';
import type { ScheduledPost } from '@/domain/records';

async function posts(): Promise<ScheduledPost[]> {
  return (await new SheetsContentRepository(new FakeSheetTransport()).listSchedule()).map((r) => r.value);
}

describe('similarity', () => {
  it('is deterministic, case/width-insensitive and ignores punctuation and emoji', () => {
    expect(textSimilarity('Ask for the band.', 'ask  FOR the band 🙂')).toBe(1);
    expect(textSimilarity('ＡＳＫ for the band', 'ask for the band')).toBe(1);
    expect(textSimilarity('', '')).toBe(1);
    expect(textSimilarity('abc', '')).toBe(0);
  });

  it('uses character bigrams for CJK', () => {
    expect([...similarityTokens('先問薪資範圍')]).toEqual(['先問', '問薪', '薪資', '資範', '範圍']);
    expect(textSimilarity('先問薪資範圍。', '先問薪資範圍')).toBe(1);
    expect(textSimilarity('先問薪資範圍', '再問你在範圍的哪裡')).toBeLessThan(0.3);
  });

  it('a small edit stays above 0.9 only when the texts are nearly identical', () => {
    const base = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty';
    expect(textSimilarity(base, `${base} extra`)).toBeGreaterThanOrEqual(0.9);
    expect(textSimilarity('Ask for the band.', 'Ask for the salary.')).toBeLessThan(0.9);
  });
});

describe('Taipei time and sync stamps', () => {
  it('planned time comes from the Content ID date and the Taipei publish time; TBD has none', () => {
    expect(plannedTaipeiIso({ contentId: '2026-10-02-MAIN-LI', publishTime: '21:00' })).toBe('2026-10-02T21:00:00+08:00');
    expect(plannedTaipeiIso({ contentId: '2026-10-02-3RD-TH', publishTime: 'TBD' })).toBeNull();
    expect(plannedTaipeiIso({ contentId: 'legacy-row', publishTime: '08:00' })).toBeNull();
  });

  it('formats +08:00 and compares instants across offsets', () => {
    expect(toTaipeiIso('2026-10-01T00:00:04Z')).toBe('2026-10-01T08:00:04+08:00');
    expect(sameInstant('2026-10-01T08:00:04+08:00', '2026-10-01T00:00:04.000Z')).toBe(true);
    expect(sameInstant('2026-10-01T08:00:04+08:00', 'not a date')).toBe(false);
  });

  it('sync stamp round-trips and legacy stamps have no hash', () => {
    const stamp = formatSyncStamp(new Date('2026-10-01T01:00:00Z'), 'text  ');
    expect(parseSyncStamp(stamp)).toEqual({ at: '2026-10-01T09:00:00+08:00', textHash: finalTextHash('text  ') });
    expect(finalTextHash('text  ')).not.toBe(finalTextHash('text'));
    expect(parseSyncStamp('2026-10-01T09:00:00+08:00')).toEqual({ at: '2026-10-01T09:00:00+08:00', textHash: null });
    expect(parseSyncStamp('')).toBeNull();
    expect(parseSyncStamp('yesterday')).toBeNull();
  });
});

describe('PUB-05: published summary states denominators and never treats blank as zero', () => {
  it('per-platform totals, coverage and last sync over the synthetic Schedule', async () => {
    const s = publishedSummary(await posts());
    expect(s.platforms.map((p) => p.platform)).toEqual(['X', 'Threads']);
    const x = s.platforms[0]!;
    expect(x.rowsIncluded).toBe(1);
    expect(x.metrics.views).toEqual({ total: 1520, rowsWithValue: 1, rowsMissing: 0 });
    expect(x.metrics.replies).toEqual({ total: 0, rowsWithValue: 1, rowsMissing: 0 });
    expect(x.metrics.newFollowers).toEqual({ total: null, rowsWithValue: 0, rowsMissing: 1 });
    expect(x.rowsMissingAnyMetric).toBe(1);
    expect(x.lastAnalyticsSyncAt).toBe('2026-10-02T09:00:00+08:00');
    const th = s.platforms[1]!;
    expect(th.metrics.views.total).toBe(830);
    expect(th.metrics.reposts).toEqual({ total: null, rowsWithValue: 0, rowsMissing: 1 });
    expect(th.rowsNeverAnalyticsSynced).toBe(1);
    expect(th.lastAnalyticsSyncAt).toBeNull();
  });

  it('platform filter and date range apply, and the range is echoed', async () => {
    const all = await posts();
    expect(publishedSummary(all, { platform: 'Threads' }).platforms.map((p) => p.platform)).toEqual(['Threads']);
    const later = publishedSummary(all, { from: '2026-10-02', to: '2026-10-31' });
    expect(later.platforms).toEqual([]);
    expect(later.range).toEqual({ from: '2026-10-02', to: '2026-10-31' });
    expect(publishedSummary(all, { from: '2026-10-01', to: '2026-10-01' }).platforms).toHaveLength(2);
  });

  it('rows with an unrecognised platform are counted as excluded, not guessed', async () => {
    const all = await posts();
    const odd = { ...all.find((p) => p.contentId === '2026-10-01-MAIN-X')!, platform: { ok: false as const, raw: 'Myspace', reason: 'unrecognised' as const } };
    expect(publishedSummary([...all, odd]).rowsExcludedUnrecognisedPlatform).toBe(1);
  });
});
