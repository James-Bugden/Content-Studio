import type { GateResult, ZhAdaptationState } from './gates';
import { BACKLOG_TABS, type BacklogPills, type BacklogTab } from './backlog';
import type { NextStep, Thumb } from './next-steps';

/**
 * View models shared by server services and client components (CS-006..CS-013).
 * Types only: services build these from authoritative reads; components render
 * them. Keeping them in the domain lets client code stay free of server modules.
 */
/**
 * Posts lanes: the backlog tabs first, then the earlier review lanes kept as URL
 * aliases (`clean`, `copyright`, `duplicate`, `approved`) so old links still work.
 */
export const LEGACY_LANES = ['clean', 'copyright', 'duplicate', 'approved'] as const;
export const LANES = [...BACKLOG_TABS, ...LEGACY_LANES] as const;
export type Lane = (typeof LANES)[number];

export type ReviewCard = {
  libraryId: string;
  revision: string;
  row: number;
  slug: string;
  source: string;
  sourceKey: string;
  sourcePlatform: string;
  targetPlatform: string;
  state: string;
  hook: string;
  preview: string;
  reviewStatus: string;
  copyrightQa: string;
  duplicateQa: string;
  queued: boolean | null;
  visual: string;
  imageStatus: string;
  hasMarkdownLink: boolean;
  /** Earlier review lane, kept for the URL aliases. */
  lane: (typeof LEGACY_LANES)[number] | 'blocked';
  gates: GateResult;
  /** Post image and its state in words (UX redesign). */
  thumb: Thumb;
  /** The single next step, same words as Next up and the panel. */
  step: NextStep;
  /** Backlog tab besides All (null: only under All, e.g. skipped). */
  tab: Exclude<BacklogTab, 'all'> | null;
  /** One pill per backlog column. */
  pills: BacklogPills;
};

export type ReviewQueue = {
  cards: ReviewCard[];
  total: number;
  totalUnfiltered: number;
  page: number;
  pages: number;
  sources: { key: string; label: string }[];
  laneCounts: Record<Lane, number>;
  /** True when the Schedule could not be read, so screenshot reuse is uncertain. */
  scheduleUnavailable: boolean;
};

export type EditorModel = {
  libraryId: string;
  slug: string;
  source: string;
  targetPlatform: string;
  reviewStatus: string;
  sheet: { revision: string; draft: string; hook: string };
  markdown:
    | { state: 'ok'; body: string; sectionHash: string; fileRevision: string; modifiedTime: string; headingLine: string }
    | { state: 'unavailable'; reason: string; code: string };
  /** Sheet draft and Markdown body differ. */
  mismatch: boolean;
  visual: string;
  gates: GateResult;
};

export type ReadyItem = {
  libraryId: string;
  revision: string;
  slug: string;
  source: string;
  targetPlatform: string;
  hook: string;
  preview: string;
  visual: string;
  gates: GateResult;
  group: 'ready' | 'needs_action' | 'blocked' | 'scheduled';
  scheduledAs: { contentId: string; date: string; slot: string }[];
  /** Downstream requirements that are not Library gates, e.g. the Threads adaptation after scheduling. */
  notes: string[];
  /** The Ready Queue tab row disagrees with Content Library (e.g. stale formula view). */
  viewDrift: boolean;
};

export type ReadyQueue = {
  items: ReadyItem[];
  orphans: string[];
  counts: Record<ReadyItem['group'], number>;
  scheduleUnavailable: boolean;
};

/** X to Threads zh-TW adaptation page (CS-011). Derived on every read; never stored. */
export type AdaptationBlocker = { code: string; message: string };

export type AdaptationThreads =
  | { kind: 'found'; contentId: string; revision: string; date: string; slot: string; hook: string; chineseContent: string; stage: string }
  | { kind: 'none' }
  | { kind: 'ambiguous'; candidates: { contentId: string; date: string; slot: string }[] };

export type AdaptationView = {
  source: { contentId: string; revision: string; date: string; slot: string; platform: string; stage: string; hook: string; content: string };
  /** Empty when the X copy is eligible for adaptation (ZHTW-01). */
  blockers: AdaptationBlocker[];
  state: ZhAdaptationState;
  threads: AdaptationThreads;
};
