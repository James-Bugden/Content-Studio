import type { ZhAdaptationState } from './gates';
import { shortHash } from './hash';
import type { ScheduledPost } from './records';
import { parseZhStamp, zhSourceMaterial } from './stage';

/**
 * X to Threads zh-TW lineage (CS-011 ZHTW-03/04).
 *
 * Pure: derived on every read from the X row and the Threads rows, never stored as
 * competing state. Freshness compares the lineage stamp in the Threads `AI Action`
 * cell with the X row's current hook and content, so any X edit after translation
 * makes the adaptation stale.
 */
export type ThreadsCandidate = { contentId: string; date: string; slot: string };

export type ThreadsResolution =
  | { kind: 'found'; post: ScheduledPost }
  | { kind: 'none' }
  | { kind: 'ambiguous'; candidates: ThreadsCandidate[] };

function isThreads(p: ScheduledPost): boolean {
  return p.platform?.ok === true && p.platform.value === 'Threads';
}

/** The live Content ID convention: `2026-10-01-MAIN-X` pairs with `2026-10-01-MAIN-TH`. */
export function threadsIdFor(xContentId: string): string | null {
  return /-X$/.test(xContentId) ? xContentId.replace(/-X$/, '-TH') : null;
}

export function resolveThreadsRow(xContentId: string, rows: readonly ScheduledPost[]): ThreadsResolution {
  const threads = rows.filter(isThreads);
  let candidates = threads.filter((p) => p.parentContentId === xContentId);
  if (candidates.length === 0) {
    const id = threadsIdFor(xContentId);
    candidates = id ? threads.filter((p) => p.contentId === id) : [];
  }
  if (candidates.length === 0) return { kind: 'none' };
  if (candidates.length > 1) {
    return { kind: 'ambiguous', candidates: candidates.map((p) => ({ contentId: p.contentId, date: p.date, slot: p.slot })) };
  }
  return { kind: 'found', post: candidates[0]! };
}

export function zhSourceHash(xHook: string, xContent: string): string {
  return shortHash(zhSourceMaterial(xHook, xContent));
}

export function adaptationState(xRow: ScheduledPost, threadsRows: readonly ScheduledPost[]): ZhAdaptationState {
  const resolved = resolveThreadsRow(xRow.contentId, threadsRows);
  if (resolved.kind === 'none') return 'missing';
  if (resolved.kind === 'ambiguous') return 'ambiguous';
  const th = resolved.post;
  const stamp = parseZhStamp(th.aiAction);
  const hasCopy = th.chineseContent.trim() !== '';
  if (!stamp) return hasCopy ? 'draft' : 'missing';
  if (stamp.parentContentId !== xRow.contentId || stamp.sourceHash !== zhSourceHash(xRow.hook, xRow.content)) return 'stale';
  if (!hasCopy) return 'missing';
  const stage = th.contentStage?.ok ? th.contentStage.value : null;
  if (stage === 'Ready') return 'approved';
  if (stage === 'ZH Review') return 'awaiting_review';
  return 'draft';
}

const ANY_ZH_STAMP = /\s*\[cs:zh-src:[^\]\s]*\]/g;

/** `AI Action` with any old lineage stamp replaced by `stamp`, other text kept. */
export function withZhStamp(aiAction: string, stamp: string): string {
  const rest = aiAction.replace(ANY_ZH_STAMP, '').trim();
  return rest ? `${rest} ${stamp}` : stamp;
}
