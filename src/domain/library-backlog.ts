import type { LibraryRecord } from './records';
import { PLATFORMS, type Platform } from './enums';
import { readableTitle } from './display';

/** `hook` (current hook text) predates CS-043 and stays valid for old links. */
export const BACKLOG_SORTS = ['sheet', 'source', 'platform', 'pesto', 'hookTemplate', 'status', 'approved', 'hook'] as const;
export type BacklogSort = (typeof BACKLOG_SORTS)[number];
export const BACKLOG_DIRECTIONS = ['asc', 'desc'] as const;
export type BacklogDirection = (typeof BACKLOG_DIRECTIONS)[number];
export const BACKLOG_GROUPS = ['source', 'platform', 'pesto', 'status'] as const;
export type BacklogGroup = (typeof BACKLOG_GROUPS)[number];
export type LibraryBacklogFilters = {
  source?: string; platform?: Platform; pesto?: string; status?: string;
  sort?: BacklogSort; dir?: BacklogDirection; group?: BacklogGroup;
  search?: string; page?: number;
};
export type BacklogReadiness = { label: string; reason: string; tone: 'good' | 'attention' | 'blocked' | 'neutral' };
export const LIBRARY_BACKLOG_PAGE_SIZE = 40;

export function libraryBacklogStatus(record: Pick<LibraryRecord, 'value'>): string {
  const { state, reviewStatus, queueForSchedule } = record.value;
  if (reviewStatus.ok && reviewStatus.value === 'Skipped') return 'Rejected';
  if (reviewStatus.ok && reviewStatus.value === 'Changes Requested') return 'Needs changes';
  if (reviewStatus.ok && reviewStatus.value === 'Approved') return queueForSchedule ? 'Schedule requested' : 'Approved';
  if (state.trim() === 'Editing') return 'Drafting';
  if (state.trim() && state.trim() !== 'Idea') return state.trim();
  return record.value.draftContent.trim() ? 'Drafting' : 'Needs review';
}

type StatusOf = (record: LibraryRecord) => string | undefined;
type Row = Pick<LibraryRecord, 'row' | 'value'>;

function statusLabel(record: Row, statusOf?: StatusOf): string {
  return statusOf?.(record as LibraryRecord) ?? libraryBacklogStatus(record);
}

/** The text a column sorts on. An empty string is a blank cell and always sorts last. */
export function backlogSortValue(record: Row, key: Exclude<BacklogSort, 'sheet'>, statusOf?: StatusOf): string {
  const v = record.value;
  switch (key) {
    case 'source': return v.contentSource.trim();
    case 'platform': return v.targetPlatform.ok ? v.targetPlatform.value : '';
    case 'pesto': return v.pesto.trim();
    case 'hookTemplate': return v.hookTemplate.trim();
    case 'hook': return v.currentHook.trim();
    case 'status': return statusLabel(record, statusOf);
    case 'approved': return v.reviewStatus.ok ? (v.reviewStatus.value === 'Approved' ? 'Approved' : 'Not approved') : '';
  }
}

const collator = new Intl.Collator('en-GB', { numeric: true, sensitivity: 'base' });

function compareValues(a: string, b: string, dir: BacklogDirection): number {
  if (!a || !b) return a === b ? 0 : a ? -1 : 1; // blanks last in both directions
  const order = collator.compare(a, b);
  return dir === 'desc' ? -order : order;
}

/**
 * Global Backlog order (CS-043). Blanks sort last in either direction and ties
 * fall back to ascending Sheet row, so pagination is stable across requests.
 */
export function compareBacklog(a: Row, b: Row, key: BacklogSort, dir: BacklogDirection = 'asc', statusOf?: StatusOf): number {
  if (key === 'sheet') return dir === 'desc' ? b.row - a.row : a.row - b.row;
  return compareValues(backlogSortValue(a, key, statusOf), backlogSortValue(b, key, statusOf), dir) || a.row - b.row;
}

/** Next sort/direction for a header click: a new column starts ascending, the same column reverses. */
export function nextHeaderSort(current: { sort?: BacklogSort; dir?: BacklogDirection }, key: BacklogSort): { sort: BacklogSort; dir: BacklogDirection } {
  if ((current.sort ?? 'sheet') !== key) return { sort: key, dir: 'asc' };
  return { sort: key, dir: (current.dir ?? 'asc') === 'asc' ? 'desc' : 'asc' };
}

export function backlogGroupKey(record: Row, group: BacklogGroup, statusOf?: StatusOf): string {
  return backlogSortValue(record, group, statusOf);
}

const BLANK_GROUP_LABEL: Record<BacklogGroup, string> = { source: 'No source', platform: 'No platform', pesto: 'No PESTO', status: 'No status' };

/** Splits already-sorted rows into contiguous labelled runs. */
export function groupBacklogRows<T extends Row>(rows: T[], group: BacklogGroup | undefined, statusOf?: StatusOf): { key: string; label: string; rows: T[] }[] {
  if (!group) return [{ key: '', label: '', rows }];
  const runs: { key: string; label: string; rows: T[] }[] = [];
  for (const record of rows) {
    const key = backlogGroupKey(record, group, statusOf);
    const last = runs.at(-1);
    if (last && last.key === key) last.rows.push(record);
    else runs.push({ key, label: key || BLANK_GROUP_LABEL[group], rows: [record] });
  }
  return runs;
}

export function libraryBacklogView(rows: LibraryRecord[], filters: LibraryBacklogFilters, statuses: ReadonlyMap<string, { label: string }> = new Map()) {
  const statusOf: StatusOf = (r) => statuses.get(r.value.libraryId)?.label;
  const sources = [...new Set(rows.map((r) => r.value.contentSource.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const platforms = PLATFORMS.filter((p) => rows.some((r) => r.value.targetPlatform.ok && r.value.targetPlatform.value === p));
  const pestoOptions = [...new Set(rows.map((r) => r.value.pesto.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const statusOptions = [...new Set(rows.map((r) => statusLabel(r, statusOf)))].sort();
  const search = filters.search?.trim().toLocaleLowerCase('en-GB') ?? '';
  const matches = rows.filter((r) =>
    (!filters.source || r.value.contentSource.trim() === filters.source) &&
    (!filters.platform || (r.value.targetPlatform.ok && r.value.targetPlatform.value === filters.platform)) &&
    (!filters.pesto || r.value.pesto.trim() === filters.pesto) &&
    (!filters.status || statusLabel(r, statusOf) === filters.status) &&
    (!search || [r.value.currentHook, r.value.draftContent, r.value.contentSource, r.value.slug, readableTitle(r.value.slug)].some((v) => v.toLocaleLowerCase('en-GB').includes(search))),
  );
  const sort = filters.sort ?? 'sheet';
  const dir = filters.dir ?? 'asc';
  const group = filters.group;
  // Sort the whole filtered inventory before slicing a page, so order is global.
  // Grouping sorts on the group key first so each group stays contiguous across pages.
  matches.sort((a, b) =>
    (group ? compareValues(backlogGroupKey(a, group, statusOf), backlogGroupKey(b, group, statusOf), 'asc') : 0) ||
    compareBacklog(a, b, sort, dir, statusOf));
  const groupTotals: Record<string, number> = {};
  if (group) for (const r of matches) { const key = backlogGroupKey(r, group, statusOf); groupTotals[key] = (groupTotals[key] ?? 0) + 1; }
  const totalPages = Math.max(1, Math.ceil(matches.length / LIBRARY_BACKLOG_PAGE_SIZE));
  const page = Math.min(Math.max(filters.page ?? 1, 1), totalPages);
  return { sources, platforms, pestoOptions, statusOptions, total: matches.length, totalPages, page, groupTotals, rows: matches.slice((page - 1) * LIBRARY_BACKLOG_PAGE_SIZE, page * LIBRARY_BACKLOG_PAGE_SIZE) };
}
