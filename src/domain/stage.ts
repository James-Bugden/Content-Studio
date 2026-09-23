import type { ContentStage, Platform } from './enums';
import { shortHash } from './hash';
import type { LibraryItem } from './records';
import { formatVisualSource } from './visual';

/**
 * Content Stage state machine (MASTER-SPEC section 4, REV-01).
 *
 * LinkedIn skips the translation states. X and Threads carry the zh-TW
 * adaptation path: the X row reaches Ready only after its Threads adaptation is
 * reviewed. Forward moves go one step at a time; backward moves go to any earlier
 * stage but must carry a reason so they are explicit and auditable.
 */
const FULL_PATH: readonly ContentStage[] = ['Idea', 'Drafting', 'EN Review', 'EN Approved', 'Translation', 'ZH Review', 'Ready'];
const LINKEDIN_PATH: readonly ContentStage[] = ['Idea', 'Drafting', 'EN Review', 'EN Approved', 'Ready'];

export function stagePath(platform: Platform): readonly ContentStage[] {
  return platform === 'LinkedIn' ? LINKEDIN_PATH : FULL_PATH;
}

export function requiresTranslation(platform: Platform): boolean {
  return platform !== 'LinkedIn';
}

export type TransitionCheck =
  | { ok: true; direction: 'forward' | 'backward' | 'same' }
  | { ok: false; reason: 'not_on_path' | 'skips_stage' | 'backward_needs_reason' };

export function checkTransition(platform: Platform, from: ContentStage, to: ContentStage, reason?: string): TransitionCheck {
  const path = stagePath(platform);
  const a = path.indexOf(from);
  const b = path.indexOf(to);
  if (a < 0 || b < 0) return { ok: false, reason: 'not_on_path' };
  if (a === b) return { ok: true, direction: 'same' };
  if (b === a + 1) return { ok: true, direction: 'forward' };
  if (b > a) return { ok: false, reason: 'skips_stage' };
  if (!reason || reason.trim().length < 3) return { ok: false, reason: 'backward_needs_reason' };
  return { ok: true, direction: 'backward' };
}

/**
 * Approval stamp. Approval belongs to the exact text, hook, language, visual
 * decision, asset, platform and placement it was given for. Any material change
 * alters the stamp, so a stored approval visibly goes stale instead of silently
 * carrying over to different copy.
 */
export function approvalMaterial(item: LibraryItem): string {
  return JSON.stringify([
    item.targetPlatform.ok ? item.targetPlatform.value : '',
    item.currentHook,
    item.draftContent,
    formatVisualSource(item.visual.source),
    item.visual.version,
    item.visual.imageFile,
  ]);
}

export function approvalStamp(item: LibraryItem): string {
  return shortHash(approvalMaterial(item));
}

const APPROVAL_STAMP_RE = /\[cs:approved:([0-9a-f]{8})\]/;

export function formatApprovalNote(item: LibraryItem, note = 'Ready for scheduling'): string {
  return `${note} [cs:approved:${approvalStamp(item)}]`;
}

export type ApprovalState = 'not_approved' | 'approved' | 'approved_legacy' | 'stale';

export function approvalState(item: LibraryItem): ApprovalState {
  if (!item.reviewStatus.ok || item.reviewStatus.value !== 'Approved') return 'not_approved';
  const match = APPROVAL_STAMP_RE.exec(item.nextAction);
  if (!match) return 'approved_legacy';
  return match[1] === approvalStamp(item) ? 'approved' : 'stale';
}

/** Visual approval stamp, stored in `Image Next Action`. */
export function visualMaterial(v: LibraryItem['visual']): string {
  return JSON.stringify([formatVisualSource(v.source), v.brief, v.imageFile, v.altText, v.version]);
}

const VISUAL_STAMP_RE = /\[cs:visual:([0-9a-f]{8})\]/;

export function formatVisualApprovalNote(v: LibraryItem['visual']): string {
  return `Approved exact revision [cs:visual:${shortHash(visualMaterial(v))}]`;
}

export type VisualApprovalState = 'not_approved' | 'approved' | 'approved_legacy' | 'stale';

export function visualApprovalState(v: LibraryItem['visual']): VisualApprovalState {
  if (!v.imageStatus.ok || v.imageStatus.value !== 'Approved') return 'not_approved';
  const match = VISUAL_STAMP_RE.exec(v.imageNextAction);
  if (!match) return 'approved_legacy';
  return match[1] === shortHash(visualMaterial(v)) ? 'approved' : 'stale';
}

/** zh-TW adaptation lineage stamp stored in the Threads row `AI Action` cell. */
const ZH_STAMP_RE = /\[cs:zh-src:([A-Za-z0-9._-]{1,64}):([0-9a-f]{8})\]/;

export function zhSourceMaterial(hook: string, content: string): string {
  return JSON.stringify([hook, content]);
}

export function formatZhStamp(parentContentId: string, hook: string, content: string): string {
  return `[cs:zh-src:${parentContentId}:${shortHash(zhSourceMaterial(hook, content))}]`;
}

export function parseZhStamp(aiAction: string): { parentContentId: string; sourceHash: string } | null {
  const match = ZH_STAMP_RE.exec(aiAction);
  return match ? { parentContentId: match[1]!, sourceHash: match[2]! } : null;
}
