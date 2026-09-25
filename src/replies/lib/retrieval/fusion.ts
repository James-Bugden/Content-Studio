import { RETRIEVAL } from '@/replies/lib/contracts/limits';
import type { Platform, Provenance } from '@/replies/lib/contracts/vocabulary';

/**
 * Rank fusion and the bounded preferences that run after it (C05).
 *
 * Reciprocal rank fusion combines lists whose scores are not comparable with one
 * another. `ts_rank_cd` and `word_similarity` are different quantities on
 * different scales, so adding or averaging them would silently let whichever one
 * happens to produce larger numbers decide the order. RRF throws the scores away
 * and keeps only the positions, which is the only honest thing to do with them.
 *
 * The resulting number is a fusion score. It is not a probability, a similarity
 * and above all not a confidence percentage: nothing in this file produces a
 * value fit to render as "87% match", and nothing downstream should invent one.
 */

export type SignalName = 'fulltext' | 'trigram' | 'semantic';

export interface RankedList {
  signal: SignalName;
  /** Ids in rank order, best first. Duplicates within one list are ignored. */
  ids: readonly string[];
}

export interface FusedItem {
  id: string;
  score: number;
  /** Which signals found this item. Useful for diagnostics, never for display. */
  signals: SignalName[];
  /** Best position across the contributing lists, one-based. */
  bestRank: number;
}

/**
 * Reciprocal rank fusion. `k` damps the advantage of the very top positions, so
 * an item ranked first by one weak signal cannot outrank an item ranked third by
 * two strong ones. 60 is C05's tuneable starting point, not a measured optimum.
 */
export function reciprocalRankFusion(
  lists: readonly RankedList[],
  k: number = RETRIEVAL.rrfK,
): FusedItem[] {
  if (!Number.isFinite(k) || k <= 0) {
    throw new RangeError('the rank fusion constant must be a positive number');
  }

  const fused = new Map<string, FusedItem>();

  for (const list of lists) {
    const seen = new Set<string>();
    let rank = 0;
    for (const id of list.ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      rank += 1;

      const existing = fused.get(id);
      const contribution = 1 / (k + rank);
      if (existing) {
        existing.score += contribution;
        existing.signals.push(list.signal);
        existing.bestRank = Math.min(existing.bestRank, rank);
      } else {
        fused.set(id, { id, score: contribution, signals: [list.signal], bestRank: rank });
      }
    }
  }

  return [...fused.values()].sort(
    (a, b) => b.score - a.score || a.bestRank - b.bestRank || (a.id < b.id ? -1 : 1),
  );
}

/**
 * Trust order for provenance. A confirmed posted reply is evidence of what the
 * owner actually published; a main post is the owner's writing but not a reply;
 * an unconfirmed edit is a draft the owner touched; an AI draft is not the
 * owner's voice at all and only appears here when explicitly asked for (C05).
 */
export const PROVENANCE_RANK: Readonly<Record<Provenance, number>> = Object.freeze({
  posted_confirmed: 3,
  published_main_post: 2,
  user_edited_unconfirmed: 1,
  ai_draft: 0,
});

/**
 * How far below the band leader an item may score and still be treated as
 * comparably relevant.
 *
 * This number is the entire anti-recency mechanism. Preferences reorder only
 * within a band, so an item that is materially less relevant cannot be promoted
 * over a stronger match for being newer, being on the right platform, or being
 * confirmed. Widening it trades that guarantee away; that is the tuning knob and
 * it should be moved only with recorded evidence from the judgement set.
 */
export const RELEVANCE_BAND = 0.15;

export interface TieBreakCandidate {
  id: string;
  score: number;
  provenance: Provenance;
  platform: Platform;
  /** Proven posting date, ISO-8601. Null when the date is genuinely unknown. */
  sortDate: string | null;
}

export interface TieBreakOptions {
  /** The platform being replied on. A preference between equals, not a filter. */
  preferPlatform?: Platform;
  band?: number;
}

/**
 * Applies the bounded provenance, platform and recency preferences.
 *
 * Order matters and is deliberate. Provenance comes first because it decides
 * whether a row may be described as a posted reply at all. Platform comes next
 * because it is a property of the request. Recency comes last because it is the
 * weakest evidence of usefulness and the one most likely to mislead: the newest
 * thing the owner wrote is not the most relevant thing they wrote.
 *
 * An unknown date sorts after a known one within its band rather than being
 * guessed into a position.
 */
export function applyTieBreaks<T extends TieBreakCandidate>(
  results: readonly T[],
  options: TieBreakOptions = {},
): T[] {
  const band = options.band ?? RELEVANCE_BAND;
  const ordered = [...results].sort(
    (a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  const out: T[] = [];
  let group: T[] = [];
  let leaderScore = Number.POSITIVE_INFINITY;

  const flush = () => {
    group.sort((a, b) => compareWithinBand(a, b, options.preferPlatform));
    out.push(...group);
    group = [];
  };

  for (const item of ordered) {
    if (group.length > 0 && item.score < leaderScore * (1 - band)) {
      flush();
    }
    if (group.length === 0) leaderScore = item.score;
    group.push(item);
  }
  flush();

  return out;
}

function compareWithinBand(
  a: TieBreakCandidate,
  b: TieBreakCandidate,
  preferPlatform: Platform | undefined,
): number {
  const provenance = PROVENANCE_RANK[b.provenance] - PROVENANCE_RANK[a.provenance];
  if (provenance !== 0) return provenance;

  if (preferPlatform) {
    const platform =
      Number(b.platform === preferPlatform) - Number(a.platform === preferPlatform);
    if (platform !== 0) return platform;
  }

  if (a.sortDate !== b.sortDate) {
    if (a.sortDate === null) return 1;
    if (b.sortDate === null) return -1;
    return a.sortDate < b.sortDate ? 1 : -1;
  }

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

