import { isHardStop, type GateCode, type GateResult } from './gates';
import type { LibraryItem, ScheduledPost } from './records';
import { renderStampMatches, visualApprovalState } from './stage';
import { parseBrief, validateBrief } from './visual';
import type { ZhAdaptationState } from './gates';

/**
 * One vocabulary for "what do I do next" and "what does the image look like",
 * shared by Next up, Posts, Calendar and the post panel, so every screen tells
 * the same story in the same words. Pure and client-safe.
 */

// ------------------------------------------------------------------ thumbnails

export type ThumbTone = 'done' | 'todo' | 'problem' | 'none';

export type Thumb = {
  /** Same-origin image URL, or null when there is nothing to show. */
  src: string | null;
  label: string;
  tone: ThumbTone;
};

export function thumbFor(libraryId: string, item: Pick<LibraryItem, 'visual'>): Thumb {
  const v = item.visual;
  const id = encodeURIComponent(libraryId);
  const approval = visualApprovalState(v);
  switch (v.source.kind) {
    case 'text_only':
      return { src: null, label: 'Text only', tone: 'done' };
    case 'undecided':
      return { src: null, label: 'No image decided', tone: 'todo' };
    case 'invalid':
      return { src: null, label: 'Image setting unreadable', tone: 'problem' };
    case 'screenshot': {
      const src = v.imageFile.trim() ? `/api/library/${id}/asset` : null;
      if (approval === 'stale') return { src, label: 'Screenshot changed since approval', tone: 'problem' };
      if (approval === 'approved' || approval === 'approved_legacy') return { src, label: 'Screenshot approved', tone: 'done' };
      return { src, label: 'Screenshot needs approval', tone: 'todo' };
    }
    case 'original_graphic': {
      const brief = parseBrief(v.brief);
      const briefOk = brief !== null && validateBrief(brief).length === 0;
      if (approval === 'stale') return { src: briefOk ? `/api/library/${id}/render?rev=draft` : null, label: 'Image out of date', tone: 'problem' };
      if (approval === 'approved' || approval === 'approved_legacy') {
        return { src: renderStampMatches(v) ? `/api/library/${id}/render?rev=current` : briefOk ? `/api/library/${id}/render?rev=draft` : null, label: 'Image approved', tone: 'done' };
      }
      if (v.version.trim() && renderStampMatches(v)) return { src: `/api/library/${id}/render?rev=current`, label: 'Image needs approval', tone: 'todo' };
      if (briefOk) return { src: `/api/library/${id}/render?rev=draft`, label: 'Draft image, not rendered yet', tone: 'todo' };
      return { src: null, label: 'Image brief to write', tone: 'todo' };
    }
  }
}

// ------------------------------------------------------------------ next steps

export type StepKind =
  | 'review'
  | 'fix_copy'
  | 'decide_duplicate'
  | 'choose_image'
  | 'finish_image'
  | 'approve_image'
  | 'queue'
  | 'schedule'
  | 'fill_slot'
  | 'translate'
  | 'review_chinese'
  | 'update_chinese'
  | 'send_to_typefully'
  | 'sync_published'
  | 'fix_sheet'
  | 'wait'
  | 'done';

export type NextStep = {
  kind: StepKind;
  /** Short button label, e.g. "Review". */
  action: string;
  /** One plain sentence explaining why. */
  why: string;
  urgency: 'now' | 'soon' | 'later' | 'none';
};

const LIB_STEP: Partial<Record<GateCode, Omit<NextStep, 'why'>>> = {
  UNRECOGNISED_VALUE: { kind: 'fix_sheet', action: 'Fix in Sheet', urgency: 'now' },
  MISSING_IDENTITY: { kind: 'fix_sheet', action: 'Fix in Sheet', urgency: 'now' },
  COPYRIGHT_REWORK: { kind: 'fix_copy', action: 'Rework copy', urgency: 'now' },
  COPYRIGHT_UNCHECKED: { kind: 'fix_sheet', action: 'Run copyright QA', urgency: 'soon' },
  DUPLICATE_CHECK: { kind: 'decide_duplicate', action: 'Decide duplicate', urgency: 'now' },
  DUPLICATE_CONFIRMED: { kind: 'fix_copy', action: 'Skip or rewrite', urgency: 'later' },
  DUPLICATE_UNCHECKED: { kind: 'fix_sheet', action: 'Run duplicate QA', urgency: 'soon' },
  MISSING_COPY: { kind: 'fix_copy', action: 'Write draft', urgency: 'soon' },
  MISSING_SOURCE_LINK: { kind: 'fix_sheet', action: 'Link Markdown', urgency: 'soon' },
  MARKDOWN_MISMATCH: { kind: 'fix_copy', action: 'Reconcile copy', urgency: 'now' },
  HOOK_MISSING: { kind: 'fix_copy', action: 'Choose hook', urgency: 'soon' },
  VISUAL_UNDECIDED: { kind: 'choose_image', action: 'Choose image', urgency: 'soon' },
  VISUAL_INVALID: { kind: 'fix_sheet', action: 'Fix image setting', urgency: 'now' },
  SCREENSHOT_REUSED: { kind: 'choose_image', action: 'Change image', urgency: 'now' },
  SCREENSHOT_UNCERTAIN: { kind: 'wait', action: 'Retry check', urgency: 'later' },
  REVIEW_PENDING: { kind: 'review', action: 'Review', urgency: 'soon' },
  REVIEW_CHANGES_REQUESTED: { kind: 'fix_copy', action: 'Make changes', urgency: 'soon' },
  REVIEW_SKIPPED: { kind: 'done', action: 'Skipped', urgency: 'none' },
  APPROVAL_STALE: { kind: 'review', action: 'Re-approve', urgency: 'now' },
  VISUAL_BRIEF_INCOMPLETE: { kind: 'finish_image', action: 'Finish image', urgency: 'soon' },
  VISUAL_ALT_TEXT_MISSING: { kind: 'finish_image', action: 'Add alt text', urgency: 'soon' },
  VISUAL_VERSION_INVALID: { kind: 'finish_image', action: 'Fix image version', urgency: 'now' },
  VISUAL_STALE: { kind: 'approve_image', action: 'Approve new image', urgency: 'now' },
  VISUAL_NOT_APPROVED: { kind: 'approve_image', action: 'Approve image', urgency: 'soon' },
  QUEUE_NOT_SET: { kind: 'queue', action: 'Queue', urgency: 'soon' },
  QUEUED_WITHOUT_APPROVAL: { kind: 'review', action: 'Review', urgency: 'now' },
};

/** Next step for a Library post, from its gate result. */
export function libraryNextStep(gates: GateResult, scheduled: boolean): NextStep {
  if (scheduled) return { kind: 'done', action: 'Scheduled', why: 'This post is in the schedule.', urgency: 'none' };
  // A real problem outranks the ordinary next step (a reused screenshot before "Review").
  const first = gates.blockers.find((g) => isHardStop(g.code)) ?? gates.blockers[0];
  if (!first) return { kind: 'schedule', action: 'Schedule', why: 'Every check passes. Pick a slot.', urgency: 'soon' };
  const step = LIB_STEP[first.code] ?? { kind: 'fix_sheet', action: 'Open', urgency: 'soon' };
  return { ...step, why: first.message };
}

export type SlotContext = {
  post: ScheduledPost;
  /** zh-TW state for X rows with content; ignored otherwise. */
  zh?: ZhAdaptationState;
  /** Publish time has passed in Taipei. */
  past: boolean;
  /** Published row not synced for 48 hours. */
  staleSync: boolean;
  /** Content ID of the X parent's zh state, for Threads rows. */
  parentZh?: ZhAdaptationState;
};

/** Next step for a Content Schedule slot. */
export function slotNextStep(c: SlotContext): NextStep {
  const p = c.post;
  const platform = p.platform?.ok ? p.platform.value : null;
  const status = p.typefullyStatus.ok ? p.typefullyStatus.value : null;
  const stage = p.contentStage?.ok ? p.contentStage.value : null;
  const hasCopy = Boolean(p.hook.trim() || p.content.trim() || p.chineseContent.trim());
  if (!p.typefullyStatus.ok || (p.contentStage && !p.contentStage.ok)) {
    return { kind: 'fix_sheet', action: 'Fix in Sheet', why: 'A status cell holds a value Content Studio does not recognise.', urgency: 'now' };
  }
  if (status === 'Published') {
    return c.staleSync
      ? { kind: 'sync_published', action: 'Sync results', why: 'Published, but final copy or numbers have not synced for 48 hours.', urgency: 'later' }
      : { kind: 'done', action: 'Published', why: 'Published and synced.', urgency: 'none' };
  }
  if (!hasCopy) {
    if (platform === 'Threads') {
      return c.past
        ? { kind: 'done', action: 'Missed', why: 'This Threads slot passed without a post.', urgency: 'none' }
        : { kind: 'wait', action: 'Waiting for X', why: 'Filled from the X post at the same time once it is approved.', urgency: 'later' };
    }
    if (c.past) return { kind: 'done', action: 'Missed', why: 'This slot passed without a post.', urgency: 'none' };
    if (!p.publishTime.trim()) return { kind: 'fix_sheet', action: 'Set time', why: 'No publish time is set for this slot, so it cannot be scheduled.', urgency: 'later' };
    return { kind: 'fill_slot', action: 'Fill slot', why: 'Open slot. Pick a Ready post for it.', urgency: 'soon' };
  }
  if (platform === 'X' && c.zh === 'stale') return { kind: 'update_chinese', action: 'Update Chinese', why: 'The X copy changed after the Threads version was made.', urgency: 'now' };
  if (platform === 'X' && c.zh === 'missing') return { kind: 'translate', action: 'Make Threads version', why: 'The matching Threads slot needs its zh-TW version.', urgency: 'soon' };
  if (platform === 'Threads') {
    if (c.parentZh === 'stale') return { kind: 'update_chinese', action: 'Update Chinese', why: 'The X copy changed after this was translated.', urgency: 'now' };
    if (stage === 'ZH Review') return { kind: 'review_chinese', action: 'Review Chinese', why: 'The Chinese version is waiting for your review.', urgency: 'soon' };
  }
  if (status === 'Not Sent' && (stage === 'Ready' || stage === 'EN Approved')) {
    if (platform === 'X' && c.zh && c.zh !== 'approved' && c.zh !== 'not_required') {
      return { kind: 'review_chinese', action: 'Finish Threads', why: 'Send both together once the Threads version is approved.', urgency: 'soon' };
    }
    return { kind: 'send_to_typefully', action: 'Send to Typefully', why: 'Ready, but not in Typefully yet.', urgency: c.past ? 'now' : 'soon' };
  }
  if ((status === 'Planned' || status === 'Typefully Draft') && c.past) {
    return { kind: 'send_to_typefully', action: 'Check Typefully', why: 'The planned time has passed and it is not published.', urgency: 'now' };
  }
  if (status === 'Error') return { kind: 'send_to_typefully', action: 'Check Typefully', why: 'Typefully reported an error.', urgency: 'now' };
  return { kind: 'wait', action: status ?? 'In progress', why: 'Nothing to do until it publishes.', urgency: 'none' };
}

export const URGENCY_ORDER: Record<NextStep['urgency'], number> = { now: 0, soon: 1, later: 2, none: 3 };
