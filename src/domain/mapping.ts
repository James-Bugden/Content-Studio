/**
 * Row mapping, kept separate from the domain types (CS-002).
 *
 * Converts a raw row (strings, as the Sheets API returns formatted values) into a
 * domain value using a discovered header index, and converts a typed patch back
 * into named cell writes. Nothing here knows about HTTP or Google.
 */
import {
  CONTENT_STAGES,
  COPYRIGHT_QA,
  DUPLICATE_QA,
  IMAGE_STATUSES,
  PLATFORMS,
  COPYRIGHT_ALIASES,
  DUPLICATE_ALIASES,
  PLATFORM_ALIASES,
  REVIEW_ALIASES,
  REVIEW_STATUSES,
  TYPEFULLY_STATUSES,
  parseBoolean,
  parseEnum,
} from './enums';
import { fingerprintValues } from './hash';
import type { LibraryItem, LibraryRecord, ScheduledPost, ScheduleRecord, VisualFields } from './records';
import { LIBRARY_HEADERS, SCHEDULE_HEADERS, type HeaderIndex, type LibraryField, type ScheduleField } from './sheet-schema';
import { parseVisualSource } from './visual';

export function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value);
}

export function readCells<F extends string>(index: HeaderIndex<F>, row: readonly unknown[]): Record<F, string> {
  const cells = {} as Record<F, string>;
  for (const [field, column] of Object.entries(index.columns) as [F, number][]) cells[field] = cellText(row[column]);
  return cells;
}

/** Revision covers the whole row so a pass-through column change is also detected. */
export function rowRevision(row: readonly unknown[], width: number): string {
  const values: string[] = [];
  for (let i = 0; i < width; i += 1) values.push(cellText(row[i]));
  while (values.length > 0 && values[values.length - 1] === '') values.pop();
  return fingerprintValues(values);
}

function num(raw: string): number | null {
  const text = raw.trim().replace(/,/g, '');
  if (text === '') return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function optionalPlatform(raw: string) {
  return raw.trim() === '' ? null : parseEnum(PLATFORMS, raw, { aliases: PLATFORM_ALIASES });
}

function visualFrom(c: Record<string, string>): VisualFields {
  return {
    source: parseVisualSource(c.visualSource ?? ''),
    imageStatus: parseEnum(IMAGE_STATUSES, c.imageStatus ?? '', { blankAs: 'Needs Brief' }),
    brief: c.imageBrief ?? '',
    imageFile: c.imageFile ?? '',
    altText: c.imageAltText ?? '',
    version: c.visualVersion ?? '',
    hasImage: c.hasImage ?? '',
    imageNextAction: c.imageNextAction ?? '',
  };
}

export function toLibraryItem(c: Record<LibraryField, string>): LibraryItem {
  return {
    libraryId: c.libraryId.trim(),
    state: c.state.trim(),
    contentSource: c.contentSource,
    sourcePlatform: optionalPlatform(c.sourcePlatform),
    targetPlatform: parseEnum(PLATFORMS, c.targetPlatform, { aliases: PLATFORM_ALIASES }),
    slug: c.slug,
    workflowRole: c.workflowRole,
    sourceMasterFile: c.sourceMasterFile,
    sourceMarkdown: c.sourceMarkdown,
    pairKey: c.pairKey,
    sourceTheme: c.sourceTheme,
    contentAngle: num(c.contentAngle),
    copyrightQa: parseEnum(COPYRIGHT_QA, c.copyrightQa, { blankAs: 'Unchecked', aliases: COPYRIGHT_ALIASES }),
    duplicateQa: parseEnum(DUPLICATE_QA, c.duplicateQa, { blankAs: 'Unchecked', aliases: DUPLICATE_ALIASES }),
    reviewStatus: parseEnum(REVIEW_STATUSES, c.reviewStatus, { blankAs: 'Pending', aliases: REVIEW_ALIASES }),
    queueForSchedule: parseBoolean(c.queueForSchedule),
    nextAction: c.nextAction,
    pesto: c.pesto,
    funnelStage: c.funnelStage,
    currentHook: c.currentHook,
    hookTemplate: c.hookTemplate,
    hookAlternatives: c.hookAlternatives,
    hookScore: num(c.hookScore),
    hookType: c.hookType,
    draftContent: c.draftContent,
    visual: visualFrom(c),
  };
}

export function toScheduledPost(c: Record<ScheduleField, string>): ScheduledPost {
  return {
    posted: parseBoolean(c.posted),
    date: c.date.trim(),
    platform: optionalPlatform(c.platform),
    slot: c.slot.trim(),
    contentId: c.contentId.trim(),
    parentContentId: c.parentContentId.trim(),
    publishTime: c.publishTime.trim(),
    sourceLink: c.sourceLink,
    hookTemplate: c.hookTemplate,
    hook: c.hook,
    content: c.content,
    chineseContent: c.chineseContent,
    pesto: c.pesto,
    postType: c.postType,
    funnelStage: c.funnelStage,
    bookReference: c.bookReference,
    potentialPost: c.potentialPost,
    contentStage: c.contentStage.trim() === '' ? null : parseEnum(CONTENT_STAGES, c.contentStage),
    aiReviewNotes: c.aiReviewNotes,
    hookAlternatives: c.hookAlternatives,
    finalContent: c.finalContent,
    aiAction: c.aiAction,
    hookScore: num(c.hookScore),
    hookType: c.hookType,
    typefullyDraftId: c.typefullyDraftId.trim(),
    typefullyStatus: parseEnum(TYPEFULLY_STATUSES, c.typefullyStatus, { blankAs: 'Not Sent' }),
    publishedAt: c.publishedAt.trim(),
    finalSyncedAt: c.finalSyncedAt.trim(),
    postLink: c.postLink.trim(),
    metrics: {
      views: num(c.views),
      likes: num(c.likes),
      reposts: num(c.reposts),
      replies: num(c.replies),
      bookmarks: num(c.bookmarks),
      newFollowers: num(c.newFollowers),
    },
    analyticsSyncedAt: c.analyticsSyncedAt.trim(),
    visual: visualFrom(c),
  };
}

/** Raw row as a transport returns it: formatted values, formulas and link targets by column. */
export type RawRow = {
  values: readonly unknown[];
  formulas?: readonly unknown[];
  links?: readonly (string | null | undefined)[];
};

function extras<F extends string>(index: HeaderIndex<F>, raw: RawRow) {
  const links: Partial<Record<F, string>> = {};
  const formulaFields: F[] = [];
  for (const [field, column] of Object.entries(index.columns) as [F, number][]) {
    const formula = raw.formulas?.[column];
    if (typeof formula === 'string' && formula.startsWith('=')) {
      formulaFields.push(field);
      const link = /^=HYPERLINK\(\s*"([^"]+)"/i.exec(formula);
      if (link) links[field] = link[1]!;
    }
    const direct = raw.links?.[column];
    if (typeof direct === 'string' && direct !== '') links[field] = direct;
  }
  return { links, formulaFields };
}

/** The revision also covers formulas, so a formula edit is detected even when its display value is unchanged. */
function revisionOf(raw: RawRow, width: number): string {
  const formulaPart = raw.formulas ? rowRevision(raw.formulas, width) : '';
  return formulaPart ? fingerprintValues([rowRevision(raw.values, width), formulaPart]) : rowRevision(raw.values, width);
}

export function toLibraryRecord(index: HeaderIndex<LibraryField>, raw: RawRow, rowNumber: number): LibraryRecord {
  const cells = readCells(index, raw.values);
  return { value: toLibraryItem(cells), row: rowNumber, revision: revisionOf(raw, index.width), cells, ...extras(index, raw) };
}

export function toScheduleRecord(index: HeaderIndex<ScheduleField>, raw: RawRow, rowNumber: number): ScheduleRecord {
  const cells = readCells(index, raw.values);
  return { value: toScheduledPost(cells), row: rowNumber, revision: revisionOf(raw, index.width), cells, ...extras(index, raw) };
}

export type LibraryPatch = Partial<Record<LibraryField, string>>;
export type SchedulePatch = Partial<Record<ScheduleField, string>>;

export const ALL_LIBRARY_FIELDS = Object.keys(LIBRARY_HEADERS) as LibraryField[];
export const ALL_SCHEDULE_FIELDS = Object.keys(SCHEDULE_HEADERS) as ScheduleField[];

/** Apply a patch to a cell map, returning a new map. Used by fakes and previews. */
export function applyPatch<F extends string>(cells: Record<F, string>, patch: Partial<Record<F, string>>): Record<F, string> {
  return { ...cells, ...patch };
}

/** True when every patched field already holds the patched value (idempotent replay). */
export function patchAlreadyApplied<F extends string>(cells: Record<F, string>, patch: Partial<Record<F, string>>): boolean {
  return (Object.entries(patch) as [F, string][]).every(([field, value]) => cells[field] === value);
}
