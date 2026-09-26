import type { LibraryRecord } from './records';
import { PLATFORMS, type Platform } from './enums';

export const BACKLOG_SORTS = ['sheet', 'source', 'hook', 'status'] as const;
export type BacklogSort = (typeof BACKLOG_SORTS)[number];
export type LibraryBacklogFilters = { source?: string; platform?: Platform; status?: string; sort?: BacklogSort; search?: string; page?: number };
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

export function libraryBacklogView(rows: LibraryRecord[], filters: LibraryBacklogFilters, statuses: ReadonlyMap<string, { label: string }> = new Map()) {
  const sources = [...new Set(rows.map((r) => r.value.contentSource.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const platforms = PLATFORMS.filter((p) => rows.some((r) => r.value.targetPlatform.ok && r.value.targetPlatform.value === p));
  const statusOptions = [...new Set(rows.map((r) => statuses.get(r.value.libraryId)?.label ?? libraryBacklogStatus(r)))].sort();
  const search = filters.search?.trim().toLocaleLowerCase('en-GB') ?? '';
  const matches = rows.filter((r) =>
    (!filters.source || r.value.contentSource.trim() === filters.source) &&
    (!filters.platform || (r.value.targetPlatform.ok && r.value.targetPlatform.value === filters.platform)) &&
    (!filters.status || (statuses.get(r.value.libraryId)?.label ?? libraryBacklogStatus(r)) === filters.status) &&
    (!search || [r.value.currentHook, r.value.draftContent, r.value.contentSource, r.value.slug].some((v) => v.toLocaleLowerCase('en-GB').includes(search))),
  );
  const sort = filters.sort ?? 'sheet';
  if (sort !== 'sheet') matches.sort((a, b) => {
    const field = (r: LibraryRecord) => sort === 'source' ? r.value.contentSource : sort === 'hook' ? r.value.currentHook : statuses.get(r.value.libraryId)?.label ?? libraryBacklogStatus(r);
    return field(a).localeCompare(field(b)) || a.row - b.row;
  });
  const totalPages = Math.max(1, Math.ceil(matches.length / LIBRARY_BACKLOG_PAGE_SIZE));
  const page = Math.min(Math.max(filters.page ?? 1, 1), totalPages);
  return { sources, platforms, statusOptions, total: matches.length, totalPages, page, rows: matches.slice((page - 1) * LIBRARY_BACKLOG_PAGE_SIZE, page * LIBRARY_BACKLOG_PAGE_SIZE) };
}
