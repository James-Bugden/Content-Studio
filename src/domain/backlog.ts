import { shortWhen } from './display';
import type { GateCode, GateResult, ZhAdaptationState } from './gates';
import type { NextStep, Thumb } from './next-steps';

/**
 * Posts backlog (UX redesign): one row per post with a pill per step, like the
 * owner's Sheet tabs. Pure and client-safe. Every pill carries a glyph and a
 * word, so state is never shown by colour alone.
 */

export type PillTone = 'done' | 'todo' | 'problem' | 'none';
export type Pill = { label: string; tone: PillTone };

export const BACKLOG_COLUMNS = ['copy', 'qa', 'review', 'image', 'chinese', 'scheduled'] as const;
export type BacklogColumn = (typeof BACKLOG_COLUMNS)[number];
export type BacklogPills = Record<BacklogColumn, Pill>;

export const COLUMN_LABEL: Record<BacklogColumn, string> = {
  copy: 'Copy',
  qa: 'QA',
  review: 'Review',
  image: 'Image',
  chinese: 'Chinese',
  scheduled: 'Scheduled',
};

export const PILL_GLYPH: Record<PillTone, string> = { done: '✓', todo: '○', problem: '!', none: '·' };

/** A Schedule row that came from this post (lineage `#lib=`), reduced to what the backlog shows. */
export type ScheduledFact = {
  contentId: string;
  isoDate: string;
  slot: string;
  platform: string;
  published: boolean;
  /** zh-TW adaptation state for an X row with copy; absent otherwise. */
  zh?: ZhAdaptationState;
};

export type BacklogFacts = {
  gates: Pick<GateResult, 'blockers'>;
  /** Canonical Review Status value, or null when the cell is unreadable. */
  reviewStatus: string | null;
  platform: string;
  thumb: Thumb;
  scheduled: ScheduledFact[];
};

const ZH_PILL: Record<ZhAdaptationState, Pill> = {
  not_required: { label: 'Not needed', tone: 'none' },
  missing: { label: 'Needs version', tone: 'todo' },
  draft: { label: 'Draft', tone: 'todo' },
  awaiting_review: { label: 'To review', tone: 'todo' },
  approved: { label: 'Approved', tone: 'done' },
  stale: { label: 'Out of date', tone: 'problem' },
  ambiguous: { label: 'Two versions', tone: 'problem' },
};

/** The pill for every backlog column, from the post's gates and schedule facts. */
export function backlogPills(f: BacklogFacts): BacklogPills {
  const codes = new Set<GateCode>(f.gates.blockers.map((g) => g.code));
  const has = (...c: GateCode[]) => c.some((x) => codes.has(x));

  const copy: Pill = has('COPYRIGHT_REWORK', 'MARKDOWN_MISMATCH', 'DUPLICATE_CONFIRMED')
    ? { label: 'Rework', tone: 'problem' }
    : has('MISSING_COPY')
      ? { label: 'Write', tone: 'todo' }
      : has('HOOK_MISSING')
        ? { label: 'Choose hook', tone: 'todo' }
        : { label: 'Done', tone: 'done' };

  const qa: Pill = has('COPYRIGHT_REWORK')
    ? { label: 'REWORK', tone: 'problem' }
    : has('DUPLICATE_CHECK')
      ? { label: 'Duplicate?', tone: 'problem' }
      : has('DUPLICATE_CONFIRMED')
        ? { label: 'Duplicate', tone: 'problem' }
        : has('COPYRIGHT_UNCHECKED', 'DUPLICATE_UNCHECKED')
          ? { label: 'Not checked', tone: 'todo' }
          : { label: 'Cleared', tone: 'done' };

  const review: Pill = has('APPROVAL_STALE', 'QUEUED_WITHOUT_APPROVAL')
    ? { label: 'Stale', tone: 'problem' }
    : f.reviewStatus === 'Approved'
      ? { label: 'Approved', tone: 'done' }
      : f.reviewStatus === 'Pending'
        ? { label: 'Not reviewed', tone: 'todo' }
        : f.reviewStatus === 'Changes Requested'
          ? { label: 'Changes', tone: 'todo' }
          : f.reviewStatus === 'Skipped'
            ? { label: 'Skipped', tone: 'none' }
            : { label: 'Unreadable', tone: 'problem' };

  const image: Pill = { label: f.thumb.label, tone: f.thumb.tone };

  let chinese: Pill;
  if (f.platform !== 'X') chinese = { label: 'n/a', tone: 'none' };
  else {
    const x = f.scheduled.find((s) => s.platform === 'X' && s.zh);
    chinese = x?.zh ? ZH_PILL[x.zh] : { label: 'After scheduling', tone: 'none' };
  }

  let scheduled: Pill;
  const first = [...f.scheduled].sort((a, b) => a.isoDate.localeCompare(b.isoDate))[0];
  if (!first) scheduled = { label: 'Not yet', tone: 'none' };
  else if (f.scheduled.every((s) => s.published)) scheduled = { label: 'Published', tone: 'done' };
  else scheduled = { label: `${shortWhen({ isoDate: first.isoDate, time: '' })}, ${first.slot}`, tone: 'done' };

  return { copy, qa, review, image, chinese, scheduled };
}

// ------------------------------------------------------------------ tabs

/** Backlog tabs, in display order. */
export const BACKLOG_TABS = ['all', 'review', 'image', 'ready', 'scheduled', 'published', 'blocked'] as const;
export type BacklogTab = (typeof BACKLOG_TABS)[number];

export const TAB_LABEL: Record<BacklogTab, string> = {
  all: 'All',
  review: 'To review',
  image: 'Needs image',
  ready: 'Ready to schedule',
  scheduled: 'Scheduled',
  published: 'Published',
  blocked: 'Blocked',
};

const IMAGE_STEPS: ReadonlySet<NextStep['kind']> = new Set(['choose_image', 'finish_image', 'approve_image']);
const BLOCKED_STEPS: ReadonlySet<NextStep['kind']> = new Set(['fix_copy', 'decide_duplicate', 'fix_sheet']);

/**
 * The one tab a post belongs to besides All, or null (for example a skipped
 * post). Same step kinds as the Next up counts, so the numbers agree.
 */
export function postTab(step: Pick<NextStep, 'kind'>, scheduled: Pick<ScheduledFact, 'published'>[], gateStatus: string): Exclude<BacklogTab, 'all'> | null {
  if (scheduled.length > 0) return scheduled.every((s) => s.published) ? 'published' : 'scheduled';
  if (step.kind === 'schedule') return 'ready';
  if (step.kind === 'review') return 'review';
  if (IMAGE_STEPS.has(step.kind)) return 'image';
  if (BLOCKED_STEPS.has(step.kind) || gateStatus === 'blocked') return 'blocked';
  return null;
}
