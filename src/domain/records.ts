import type {
  ContentStage,
  CopyrightQa,
  DuplicateQa,
  EnumParse,
  ImageStatus,
  Platform,
  ReviewStatus,
  Slot,
  TypefullyStatus,
} from './enums';
import type { LibraryField, ScheduleField } from './sheet-schema';
import type { VisualDecision } from './visual';

/** Visual fields shared by Library and Schedule rows. */
export type VisualFields = {
  source: VisualDecision;
  imageStatus: EnumParse<ImageStatus>;
  brief: string;
  imageFile: string;
  altText: string;
  version: string;
  /** Display value, often formula-derived (e.g. `No file`). Never written. */
  hasImage: string;
  imageNextAction: string;
};

export type LibraryItem = {
  libraryId: string;
  /** Library `State` (e.g. `Editing`). Display only: the canonical stage lives on Schedule rows. */
  state: string;
  contentSource: string;
  sourcePlatform: EnumParse<Platform> | null;
  targetPlatform: EnumParse<Platform>;
  slug: string;
  workflowRole: string;
  sourceMasterFile: string;
  sourceMarkdown: string;
  pairKey: string;
  sourceTheme: string;
  contentAngle: number | null;
  copyrightQa: EnumParse<CopyrightQa>;
  duplicateQa: EnumParse<DuplicateQa>;
  reviewStatus: EnumParse<ReviewStatus>;
  queueForSchedule: boolean | null;
  nextAction: string;
  pesto: string;
  funnelStage: string;
  currentHook: string;
  hookTemplate: string;
  hookAlternatives: string;
  hookScore: number | null;
  hookType: string;
  draftContent: string;
  visual: VisualFields;
};

export type ScheduledPost = {
  posted: boolean | null;
  date: string;
  platform: EnumParse<Platform> | null;
  slot: string;
  contentId: string;
  parentContentId: string;
  publishTime: string;
  sourceLink: string;
  hookTemplate: string;
  hook: string;
  content: string;
  chineseContent: string;
  pesto: string;
  postType: string;
  funnelStage: string;
  bookReference: string;
  potentialPost: string;
  contentStage: EnumParse<ContentStage> | null;
  aiReviewNotes: string;
  hookAlternatives: string;
  finalContent: string;
  aiAction: string;
  hookScore: number | null;
  hookType: string;
  typefullyDraftId: string;
  typefullyStatus: EnumParse<TypefullyStatus>;
  publishedAt: string;
  finalSyncedAt: string;
  postLink: string;
  metrics: {
    views: number | null;
    likes: number | null;
    reposts: number | null;
    replies: number | null;
    bookmarks: number | null;
    newFollowers: number | null;
  };
  analyticsSyncedAt: string;
  visual: VisualFields;
};

/**
 * A domain value plus everything needed to write back safely: the 1-based sheet
 * row, a fingerprint over every cell in the row (including pass-through columns)
 * and the raw mapped cells as read.
 */
export type SheetRecord<T, F extends string> = {
  value: T;
  row: number;
  revision: string;
  cells: Record<F, string>;
  /** Hyperlink targets for cells that display link text (e.g. `Open master`). */
  links: Partial<Record<F, string>>;
  /** Fields whose cell holds a formula. These are never written. */
  formulaFields: F[];
};

export type LibraryRecord = SheetRecord<LibraryItem, LibraryField>;
export type ScheduleRecord = SheetRecord<ScheduledPost, ScheduleField>;

export type QueueSummaryRow = { source: string; counts: Record<string, number | null>; masterLink: string };

export type SlotPolicy = { platform: Platform; slot: Slot; time: string | 'TBD' };

export type WorkflowSettings = {
  timezone: string;
  slots: SlotPolicy[];
  /** Raw key/value pairs, kept for display. Unknown keys never change behaviour. */
  raw: Record<string, string>;
  problems: string[];
};
