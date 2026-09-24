/**
 * Exact current Sheet mapping (MASTER-SPEC section 5, MAP-01).
 *
 * Every header is mapped exactly once to a domain field key. Headers are discovered
 * by exact name at runtime, never by position, so column order can change. A header
 * that is present but not listed here is preserved as pass-through and never written.
 */

export const LIBRARY_HEADERS = {
  libraryId: 'Library ID',
  state: 'State',
  contentSource: 'Content Source',
  sourcePlatform: 'Source Platform',
  targetPlatform: 'Target Platform',
  slug: 'Post / Slug',
  workflowRole: 'Workflow Role',
  sourceMasterFile: 'Source Master File',
  sourceMarkdown: 'Source Markdown',
  pairKey: 'Pair Key',
  sourceTheme: 'Source Theme',
  contentAngle: 'Content Angle (1-14)',
  copyrightQa: 'Copyright QA',
  duplicateQa: 'Duplicate QA',
  reviewStatus: 'Review Status',
  queueForSchedule: 'Queue for Schedule',
  nextAction: 'Next Action',
  pesto: 'PESTO',
  funnelStage: 'Funnel Stage',
  currentHook: 'Current Hook',
  hookTemplate: 'Hook Template',
  hookAlternatives: 'Hook Alternatives',
  hookScore: 'Hook Score',
  hookType: 'Hook Type',
  draftContent: 'Draft Content',
  visualSource: 'Visual Source',
  imageStatus: 'Image Status',
  imageBrief: 'Image Brief',
  imageFile: 'Image File',
  imageAltText: 'Image Alt Text',
  visualVersion: 'Visual Version',
  hasImage: 'Has Image',
  imageNextAction: 'Image Next Action',
} as const;

export type LibraryField = keyof typeof LIBRARY_HEADERS;

export const SCHEDULE_HEADERS = {
  posted: 'Posted',
  date: 'Date',
  platform: 'Platform',
  slot: 'Slot',
  contentId: 'Content ID',
  parentContentId: 'Parent Content ID',
  publishTime: 'Publish Time (Taipei)',
  sourceLink: 'Source MD / Drive Link',
  hookTemplate: 'Hook Template',
  hook: 'Hook',
  content: 'Content',
  chineseContent: 'Chinese Content',
  pesto: 'PESTO',
  postType: 'Post type',
  funnelStage: 'Funnel Stage',
  bookReference: 'Book Reference',
  potentialPost: 'Potential Post',
  contentStage: 'Content Stage',
  aiReviewNotes: 'AI Review Notes',
  hookAlternatives: 'Hook Alternatives',
  finalContent: 'Final Content',
  aiAction: 'AI Action',
  hookScore: 'Hook Score',
  hookType: 'Hook Type',
  typefullyDraftId: 'Typefully Draft ID',
  typefullyStatus: 'Typefully Status',
  publishedAt: 'Published At',
  finalSyncedAt: 'Final Synced From Typefully',
  postLink: 'Post Link',
  views: 'Views',
  likes: 'Likes',
  reposts: 'Reposts/Shares',
  replies: 'Replies/Comments',
  bookmarks: 'Bookmarks',
  newFollowers: 'New Followers',
  analyticsSyncedAt: 'Analytics Synced At',
  visualSource: 'Visual Source',
  imageStatus: 'Image Status',
  imageBrief: 'Image Brief',
  imageFile: 'Image File',
  imageAltText: 'Image Alt Text',
  visualVersion: 'Visual Version',
  hasImage: 'Has Image',
  imageNextAction: 'Image Next Action',
} as const;

export type ScheduleField = keyof typeof SCHEDULE_HEADERS;

export const SHEET_TABS = {
  library: { name: 'Content Library', headerRow: 1, lastColumn: 'AG', writable: true },
  queue: { name: 'Content Queue', headerRow: 1, lastColumn: 'AG', writable: true },
  readyQueue: { name: 'Ready Queue', headerRow: 1, lastColumn: 'AG', writable: false },
  schedule: { name: 'Content Schedule', headerRow: 2, lastColumn: 'AR', writable: true },
  queueSummary: { name: 'Content Queue Summary', headerRow: 1, lastColumn: 'Z', writable: false },
  settings: { name: 'Workflow Settings', headerRow: 1, lastColumn: 'Z', writable: false },
} as const;

export type SheetTabKey = keyof typeof SHEET_TABS;

/** Fields the app may ever write. Anything else is read-only even when mapped. */
export const LIBRARY_WRITABLE: readonly LibraryField[] = [
  'state',
  'copyrightQa',
  'duplicateQa',
  'reviewStatus',
  'queueForSchedule',
  'nextAction',
  'currentHook',
  'hookTemplate',
  'hookAlternatives',
  'hookScore',
  'hookType',
  'draftContent',
  'visualSource',
  'imageStatus',
  'imageBrief',
  'imageFile',
  'imageAltText',
  'visualVersion',
  'hasImage',
  'imageNextAction',
];

export const SCHEDULE_WRITABLE: readonly ScheduleField[] = (Object.keys(SCHEDULE_HEADERS) as ScheduleField[]).filter(
  (field) => field !== 'posted',
);

/** Fields the analytics/final sync may touch, and nothing else (PUB-03). */
export const SCHEDULE_SYNC_FIELDS: readonly ScheduleField[] = [
  'typefullyStatus',
  'publishedAt',
  'finalSyncedAt',
  'postLink',
  'finalContent',
  'views',
  'likes',
  'reposts',
  'replies',
  'bookmarks',
  'newFollowers',
  'analyticsSyncedAt',
];

export type HeaderIndex<F extends string> = {
  /** Column index (0-based) for every mapped field. */
  columns: Record<F, number>;
  /** Unknown extra headers, preserved and never written. */
  passthrough: { header: string; column: number }[];
  width: number;
};

export type SchemaProblem =
  | { kind: 'missing'; header: string }
  | { kind: 'duplicate'; header: string; columns: number[] };

/**
 * Discover a tab's columns by exact header name (MAP-02, MAP-04). Trailing spaces
 * in a header cell are tolerated; anything else (a rename, a missing column or a
 * duplicate) is schema drift and the caller must refuse to write.
 */
export function discoverHeaders<F extends string>(
  headers: Record<F, string>,
  headerRow: readonly unknown[],
): { ok: true; index: HeaderIndex<F> } | { ok: false; problems: SchemaProblem[] } {
  const positions = new Map<string, number[]>();
  headerRow.forEach((cell, column) => {
    const name = String(cell ?? '').trim();
    if (name === '') return;
    positions.set(name, [...(positions.get(name) ?? []), column]);
  });

  const problems: SchemaProblem[] = [];
  const columns = {} as Record<F, number>;
  for (const [field, header] of Object.entries(headers) as [F, string][]) {
    const found = positions.get(header) ?? [];
    if (found.length === 0) problems.push({ kind: 'missing', header });
    else if (found.length > 1) problems.push({ kind: 'duplicate', header, columns: found });
    else columns[field] = found[0]!;
  }

  const known = new Set(Object.values(headers) as string[]);
  const passthrough: { header: string; column: number }[] = [];
  for (const [name, cols] of positions) {
    if (known.has(name)) continue;
    for (const column of cols) passthrough.push({ header: name, column });
  }

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, index: { columns, passthrough, width: headerRow.length } };
}

/** 0-based column index to A1 letters. */
export function columnLetter(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}
