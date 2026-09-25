import { describe, it, expect } from 'vitest';
import { RETRIEVAL } from '@/replies/lib/contracts/limits';
import {
  applyTieBreaks,
  reciprocalRankFusion,
  RELEVANCE_BAND,
  type TieBreakCandidate,
} from '@/replies/lib/retrieval/fusion';

/**
 * The ranking rules, tested without a database.
 *
 * The rule worth protecting is the last one: a bounded preference may reorder
 * matches that are already comparably relevant, and may never promote a weaker
 * match over a stronger one. Everything else here exists to make that rule
 * legible.
 */

const base = {
  provenance: 'posted_confirmed' as const,
  platform: 'linkedin' as const,
  sortDate: '2026-01-01T00:00:00Z',
};

describe('reciprocalRankFusion', () => {
  it('prefers agreement between signals over a single strong opinion', () => {
    const fused = reciprocalRankFusion([
      { signal: 'fulltext', ids: ['solo', 'both'] },
      { signal: 'trigram', ids: ['other', 'both'] },
    ]);

    expect(fused[0]!.id).toBe('both');
    expect(fused[0]!.signals).toEqual(['fulltext', 'trigram']);
    expect(fused[0]!.bestRank).toBe(2);
  });

  it('uses the tuneable constant from the limits contract by default', () => {
    const [item] = reciprocalRankFusion([{ signal: 'fulltext', ids: ['a'] }]);
    expect(item!.score).toBeCloseTo(1 / (RETRIEVAL.rrfK + 1), 12);

    const [damped] = reciprocalRankFusion([{ signal: 'fulltext', ids: ['a'] }], 600);
    expect(damped!.score).toBeLessThan(item!.score);
  });

  it('refuses a constant that would divide by zero or invert the ranking', () => {
    expect(() => reciprocalRankFusion([{ signal: 'fulltext', ids: ['a'] }], 0)).toThrow(RangeError);
    expect(() => reciprocalRankFusion([{ signal: 'fulltext', ids: ['a'] }], -60)).toThrow(
      RangeError,
    );
  });

  it('counts a repeated id inside one list once', () => {
    const fused = reciprocalRankFusion([{ signal: 'trigram', ids: ['a', 'a', 'b'] }]);
    expect(fused.map((f) => f.id)).toEqual(['a', 'b']);
    expect(fused[0]!.score).toBeCloseTo(1 / (RETRIEVAL.rrfK + 1), 12);
  });

  it('emits no field that could be mistaken for a confidence percentage', () => {
    const [item] = reciprocalRankFusion([{ signal: 'fulltext', ids: ['a'] }]);
    expect(Object.keys(item!).sort()).toEqual(['bestRank', 'id', 'score', 'signals']);
    expect(item!.score).toBeLessThan(1);
  });
});

describe('applyTieBreaks', () => {
  it('does not let a recent weaker match overtake a clearly stronger older one', () => {
    const results: TieBreakCandidate[] = [
      { ...base, id: 'strong-old', score: 0.033, sortDate: '2024-01-05T00:00:00Z' },
      { ...base, id: 'weak-new', score: 0.016, sortDate: '2026-09-20T00:00:00Z' },
    ];

    expect(applyTieBreaks(results).map((r) => r.id)).toEqual(['strong-old', 'weak-new']);
    // Still true when the newer item is also the more trusted provenance and on
    // the preferred platform: relevance qualification happens first.
    const loaded: TieBreakCandidate[] = [
      {
        ...base,
        id: 'strong-old',
        score: 0.033,
        sortDate: '2024-01-05T00:00:00Z',
        provenance: 'user_edited_unconfirmed',
        platform: 'x',
      },
      { ...base, id: 'weak-new', score: 0.016, sortDate: '2026-09-20T00:00:00Z' },
    ];
    expect(applyTieBreaks(loaded, { preferPlatform: 'linkedin' }).map((r) => r.id)).toEqual([
      'strong-old',
      'weak-new',
    ]);
  });

  it('prefers the newer of two comparably relevant matches', () => {
    const results: TieBreakCandidate[] = [
      { ...base, id: 'older', score: 0.033, sortDate: '2024-01-05T00:00:00Z' },
      { ...base, id: 'newer', score: 0.0325, sortDate: '2026-09-20T00:00:00Z' },
    ];

    expect(applyTieBreaks(results).map((r) => r.id)).toEqual(['newer', 'older']);
  });

  it('ranks provenance above platform and platform above recency', () => {
    const results: TieBreakCandidate[] = [
      {
        id: 'draft-new-right-platform',
        score: 0.03,
        provenance: 'ai_draft',
        platform: 'linkedin',
        sortDate: '2026-09-20T00:00:00Z',
      },
      {
        id: 'confirmed-old-wrong-platform',
        score: 0.03,
        provenance: 'posted_confirmed',
        platform: 'threads',
        sortDate: '2024-01-05T00:00:00Z',
      },
      {
        id: 'main-post-right-platform',
        score: 0.03,
        provenance: 'published_main_post',
        platform: 'linkedin',
        sortDate: '2025-01-05T00:00:00Z',
      },
    ];

    expect(applyTieBreaks(results, { preferPlatform: 'linkedin' }).map((r) => r.id)).toEqual([
      'confirmed-old-wrong-platform',
      'main-post-right-platform',
      'draft-new-right-platform',
    ]);
  });

  it('puts an unknown date last among equals instead of guessing one', () => {
    const results: TieBreakCandidate[] = [
      { ...base, id: 'undated', score: 0.03, sortDate: null },
      { ...base, id: 'dated', score: 0.03, sortDate: '2020-01-01T00:00:00Z' },
    ];

    expect(applyTieBreaks(results).map((r) => r.id)).toEqual(['dated', 'undated']);
  });

  it('keeps the band narrow enough that a second-tier match stays second tier', () => {
    const leader = 1;
    const justInside = leader * (1 - RELEVANCE_BAND) + 1e-9;
    const justOutside = leader * (1 - RELEVANCE_BAND) - 1e-9;

    const inside = applyTieBreaks([
      { ...base, id: 'leader', score: leader, sortDate: '2020-01-01T00:00:00Z' },
      { ...base, id: 'challenger', score: justInside, sortDate: '2026-01-01T00:00:00Z' },
    ]);
    expect(inside.map((r) => r.id)).toEqual(['challenger', 'leader']);

    const outside = applyTieBreaks([
      { ...base, id: 'leader', score: leader, sortDate: '2020-01-01T00:00:00Z' },
      { ...base, id: 'challenger', score: justOutside, sortDate: '2026-01-01T00:00:00Z' },
    ]);
    expect(outside.map((r) => r.id)).toEqual(['leader', 'challenger']);
  });

  it('is stable for identical candidates', () => {
    const results: TieBreakCandidate[] = [
      { ...base, id: 'b', score: 0.03 },
      { ...base, id: 'a', score: 0.03 },
    ];
    expect(applyTieBreaks(results).map((r) => r.id)).toEqual(['a', 'b']);
  });
});

