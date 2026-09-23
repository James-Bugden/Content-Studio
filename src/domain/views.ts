import type { GateResult, ZhAdaptationState } from './gates';

/**
 * View models shared by server services and client components (CS-006..CS-013).
 * Types only: services build these from authoritative reads; components render
 * them. Keeping them in the domain lets client code stay free of server modules.
 */
export const LANES = ['all', 'clean', 'copyright', 'duplicate', 'blocked', 'approved'] as const;
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
  lane: Exclude<Lane, 'all' | 'blocked'> | 'blocked';
  gates: GateResult;
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
