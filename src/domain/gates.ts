import type { Platform } from './enums';
import type { LibraryItem } from './records';
import { approvalState, requiresTranslation, visualApprovalState } from './stage';
import { parseBrief, parseVisualVersion, validateBrief } from './visual';
import { languageFor } from './enums';

/**
 * Release-gate engine (CS-002, READY-01).
 *
 * Pure and table-testable. Every blocker names the field, a plain explanation and
 * the one next action that clears it. The derived status (ready / needs_action /
 * blocked) is computed on every read and never written back as competing state.
 */
export const GATE_CODES = [
  'UNRECOGNISED_VALUE',
  'MISSING_IDENTITY',
  'COPYRIGHT_REWORK',
  'COPYRIGHT_UNCHECKED',
  'DUPLICATE_CHECK',
  'DUPLICATE_CONFIRMED',
  'DUPLICATE_UNCHECKED',
  'MISSING_COPY',
  'MISSING_SOURCE_LINK',
  'MARKDOWN_MISMATCH',
  'HOOK_MISSING',
  'REVIEW_PENDING',
  'REVIEW_CHANGES_REQUESTED',
  'REVIEW_SKIPPED',
  'APPROVAL_STALE',
  'APPROVAL_LEGACY',
  'QUEUE_NOT_SET',
  'QUEUED_WITHOUT_APPROVAL',
  'ZH_ADAPTATION_MISSING',
  'ZH_ADAPTATION_NOT_REVIEWED',
  'ZH_ADAPTATION_STALE',
  'ZH_ADAPTATION_AMBIGUOUS',
  'VISUAL_UNDECIDED',
  'VISUAL_INVALID',
  'VISUAL_BRIEF_INCOMPLETE',
  'VISUAL_VERSION_INVALID',
  'VISUAL_NOT_APPROVED',
  'VISUAL_STALE',
  'VISUAL_ALT_TEXT_MISSING',
  'SCREENSHOT_REUSED',
  'SCREENSHOT_UNCERTAIN',
] as const;
export type GateCode = (typeof GATE_CODES)[number];

export type Gate = {
  code: GateCode;
  severity: 'hard' | 'soft';
  field: string;
  message: string;
  nextAction: string;
  /** Needs a person (true) or can be resolved by an integration step (false). */
  human: boolean;
};

export type ZhAdaptationState = 'not_required' | 'missing' | 'draft' | 'awaiting_review' | 'approved' | 'stale' | 'ambiguous';

export type ScreenshotUse = { platform: Platform; libraryId?: string; contentId?: string };

export type GateContext = {
  /** `review` evaluates approvability; `ready` also requires the queue checkbox and downstream gates. */
  purpose: 'review' | 'ready';
  zh?: ZhAdaptationState;
  /** Other rows (Library and Schedule) using the same screenshot id; `null` when the check could not run. */
  screenshotUses?: ScreenshotUse[] | null;
  markdown?: 'ok' | 'mismatch' | 'unknown';
};

export type GateStatus = 'ready' | 'needs_action' | 'blocked';

export type GateResult = {
  status: GateStatus;
  blockers: Gate[];
  warnings: Gate[];
  /** The single most important thing to do next, or null when ready. */
  next: Gate | null;
};

function hard(code: GateCode, field: string, message: string, nextAction: string, human = true): Gate {
  return { code, severity: 'hard', field, message, nextAction, human };
}
function soft(code: GateCode, field: string, message: string, nextAction: string, human = true): Gate {
  return { code, severity: 'soft', field, message, nextAction, human };
}

/** Evaluation order is also priority order for the single next action. */
export function evaluateLibraryGates(item: LibraryItem, ctx: GateContext): GateResult {
  const gates: Gate[] = [];

  // Unrecognised enum values block: an untrusted cell must not choose a code path.
  const enums: [string, { ok: boolean }][] = [
    ['Target Platform', item.targetPlatform],
    ['Copyright QA', item.copyrightQa],
    ['Duplicate QA', item.duplicateQa],
    ['Review Status', item.reviewStatus],
    ['Image Status', item.visual.imageStatus],
  ];
  if (item.sourcePlatform) enums.push(['Source Platform', item.sourcePlatform]);
  for (const [field, parsed] of enums) {
    if (!parsed.ok) {
      gates.push(hard('UNRECOGNISED_VALUE', field, `${field} holds a value Content Studio does not recognise.`, `Set ${field} to a listed value in the Sheet`));
    }
  }
  if (item.queueForSchedule === null) {
    gates.push(hard('UNRECOGNISED_VALUE', 'Queue for Schedule', 'Queue for Schedule is not a checkbox value.', 'Reset the Queue for Schedule checkbox'));
  }
  if (item.libraryId === '') gates.push(hard('MISSING_IDENTITY', 'Library ID', 'This row has no Library ID.', 'Add a Library ID in the Sheet'));

  // Risk.
  if (item.copyrightQa.ok) {
    if (item.copyrightQa.value === 'REWORK') {
      gates.push(hard('COPYRIGHT_REWORK', 'Copyright QA', 'Copyright QA says this needs rework.', 'Rework the copy, then re-run copyright QA'));
    } else if (item.copyrightQa.value === 'Unchecked') {
      gates.push(hard('COPYRIGHT_UNCHECKED', 'Copyright QA', 'Copyright QA has not been run.', 'Run copyright QA'));
    }
  }
  if (item.duplicateQa.ok) {
    if (item.duplicateQa.value === 'CHECK') {
      gates.push(hard('DUPLICATE_CHECK', 'Duplicate QA', 'A possible duplicate needs a decision.', 'Decide whether this duplicates earlier content'));
    } else if (item.duplicateQa.value === 'DUPLICATE') {
      gates.push(hard('DUPLICATE_CONFIRMED', 'Duplicate QA', 'This is a confirmed duplicate.', 'Skip this item or rewrite it as new content'));
    } else if (item.duplicateQa.value === 'Unchecked') {
      gates.push(hard('DUPLICATE_UNCHECKED', 'Duplicate QA', 'Duplicate QA has not been run.', 'Run duplicate QA'));
    }
  }

  // Editorial.
  if (item.draftContent.trim() === '') gates.push(hard('MISSING_COPY', 'Draft Content', 'There is no platform copy yet.', 'Write the draft in the editor'));
  if (item.sourceMarkdown.trim() === '' && item.sourceMasterFile.trim() === '') {
    gates.push(hard('MISSING_SOURCE_LINK', 'Source Markdown', 'No source Markdown is linked.', 'Link the source Markdown file in the Sheet'));
  }
  if (ctx.markdown === 'mismatch') {
    gates.push(hard('MARKDOWN_MISMATCH', 'Draft Content', 'The Sheet draft and the Markdown section differ.', 'Open the editor and reconcile the two versions'));
  }
  if (item.currentHook.trim() === '') gates.push(hard('HOOK_MISSING', 'Current Hook', 'No hook has been chosen.', 'Choose a hook'));

  // Review.
  const approval = approvalState(item);
  if (item.reviewStatus.ok) {
    const status = item.reviewStatus.value;
    if (status === 'Pending') gates.push(hard('REVIEW_PENDING', 'Review Status', 'Waiting for review.', 'Review and approve, or request changes'));
    if (status === 'Changes Requested') {
      gates.push(hard('REVIEW_CHANGES_REQUESTED', 'Review Status', 'Changes were requested.', 'Make the requested changes, then send back to review'));
    }
    if (status === 'Skipped') gates.push(hard('REVIEW_SKIPPED', 'Review Status', 'This item was skipped.', 'Nothing to do unless you reopen it'));
  }
  if (approval === 'stale') {
    gates.push(hard('APPROVAL_STALE', 'Review Status', 'The copy, hook or visual changed after approval.', 'Review the changes and approve again'));
  }
  if (approval === 'approved_legacy') {
    gates.push(soft('APPROVAL_LEGACY', 'Review Status', 'Approved outside Content Studio, so later edits cannot be detected.', 'Re-approve here to protect this approval'));
  }

  // Queue (ready purpose only).
  const approvedNow = approval === 'approved' || approval === 'approved_legacy';
  if (ctx.purpose === 'ready') {
    if (item.queueForSchedule === true && !approvedNow) {
      gates.push(hard('QUEUED_WITHOUT_APPROVAL', 'Queue for Schedule', 'Queued for schedule but not approved.', 'Approve the item, or untick the queue checkbox'));
    } else if (item.queueForSchedule !== true) {
      gates.push(hard('QUEUE_NOT_SET', 'Queue for Schedule', 'Not queued for schedule yet.', 'Tick Queue for Schedule'));
    }
  }

  // zh-TW adaptation (X and Threads only).
  const platform = item.targetPlatform.ok ? item.targetPlatform.value : null;
  if (ctx.purpose === 'ready' && platform && requiresTranslation(platform) && platform === 'X') {
    switch (ctx.zh ?? 'missing') {
      case 'missing':
        gates.push(hard('ZH_ADAPTATION_MISSING', 'Threads adaptation', 'The Threads zh-TW adaptation does not exist yet.', 'Create the Threads adaptation from the approved X copy', false));
        break;
      case 'draft':
      case 'awaiting_review':
        gates.push(hard('ZH_ADAPTATION_NOT_REVIEWED', 'Threads adaptation', 'The Threads adaptation has not passed Chinese review.', 'Review and approve the zh-TW adaptation'));
        break;
      case 'stale':
        gates.push(hard('ZH_ADAPTATION_STALE', 'Threads adaptation', 'The X copy changed after the Threads adaptation was made.', 'Regenerate or update the zh-TW adaptation'));
        break;
      case 'ambiguous':
        gates.push(hard('ZH_ADAPTATION_AMBIGUOUS', 'Threads adaptation', 'More than one Threads row claims this X post.', 'Choose the correct Threads row'));
        break;
      default:
        break;
    }
  }

  // Visual.
  gates.push(...visualGates(item, ctx, platform));

  const blockers = gates.filter((g) => g.severity === 'hard');
  const warnings = gates.filter((g) => g.severity === 'soft');
  const status: GateStatus = blockers.length === 0 ? 'ready' : blockers.every((g) => !isHardStop(g.code)) ? 'needs_action' : 'blocked';
  return { status, blockers, warnings, next: blockers[0] ?? warnings[0] ?? null };
}

/** Hard stops are problems, not just the next ordinary workflow step. */
const HARD_STOPS: ReadonlySet<GateCode> = new Set<GateCode>([
  'UNRECOGNISED_VALUE',
  'MISSING_IDENTITY',
  'COPYRIGHT_REWORK',
  'DUPLICATE_CHECK',
  'DUPLICATE_CONFIRMED',
  'MARKDOWN_MISMATCH',
  'APPROVAL_STALE',
  'QUEUED_WITHOUT_APPROVAL',
  'ZH_ADAPTATION_STALE',
  'ZH_ADAPTATION_AMBIGUOUS',
  'VISUAL_INVALID',
  'VISUAL_STALE',
  'VISUAL_VERSION_INVALID',
  'SCREENSHOT_REUSED',
  'SCREENSHOT_UNCERTAIN',
  'REVIEW_SKIPPED',
]);

export function isHardStop(code: GateCode): boolean {
  return HARD_STOPS.has(code);
}

function visualGates(item: LibraryItem, ctx: GateContext, platform: Platform | null): Gate[] {
  const v = item.visual;
  const out: Gate[] = [];
  switch (v.source.kind) {
    case 'undecided':
      out.push(hard('VISUAL_UNDECIDED', 'Visual Source', 'No visual decision yet.', 'Choose Text only, Original graphic or a screenshot'));
      return out;
    case 'invalid':
      out.push(hard('VISUAL_INVALID', 'Visual Source', 'Visual Source is not a recognised decision or screenshot id.', 'Fix Visual Source in the Sheet'));
      return out;
    case 'text_only':
      return out;
    case 'screenshot': {
      const uses = ctx.screenshotUses;
      if (uses === null) {
        out.push(hard('SCREENSHOT_UNCERTAIN', 'Visual Source', 'Screenshot reuse could not be checked.', 'Retry the reuse check before approving'));
      } else if (uses && platform && uses.some((u) => u.platform === platform)) {
        out.push(hard('SCREENSHOT_REUSED', 'Visual Source', `This screenshot is already used on ${platform}.`, 'Use Text only or a fresh original graphic'));
      }
      break;
    }
    case 'original_graphic': {
      const problems = validateBrief(parseBrief(v.brief));
      if (problems.length > 0) {
        out.push(hard('VISUAL_BRIEF_INCOMPLETE', 'Image Brief', `The visual brief is incomplete (${problems.map((p) => p.field).join(', ')}).`, 'Complete the brief in Visual Studio'));
      }
      break;
    }
  }

  if (v.altText.trim() === '') out.push(hard('VISUAL_ALT_TEXT_MISSING', 'Image Alt Text', 'The image has no alt text.', 'Write alt text for the image'));

  if (v.source.kind === 'original_graphic') {
    const version = parseVisualVersion(v.version);
    if (v.version.trim() !== '' && !version) {
      out.push(hard('VISUAL_VERSION_INVALID', 'Visual Version', 'Visual Version is not SOAR-v1.1 / rNN / platform / language.', 'Fix the Visual Version'));
    } else if (version && platform && (version.platform !== platform || version.language !== languageFor(platform))) {
      out.push(hard('VISUAL_STALE', 'Visual Version', 'The approved asset is for a different platform or language.', 'Render and approve an asset for this platform'));
    }
  }

  const visualApproval = visualApprovalState(v);
  if (visualApproval === 'stale') {
    out.push(hard('VISUAL_STALE', 'Image Status', 'The brief, file or alt text changed after the image was approved.', 'Review the new revision and approve it'));
  } else if (visualApproval === 'not_approved') {
    out.push(hard('VISUAL_NOT_APPROVED', 'Image Status', 'The image is not approved yet.', 'Review the image at full size and phone width, then approve'));
  }
  return out;
}
