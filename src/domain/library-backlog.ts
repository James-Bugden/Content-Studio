import type { LibraryRecord } from './records';
import { PLATFORMS, type Platform } from './enums';

export type LibraryBacklogFilters = { source?: string; platform?: Platform; page?: number };
export const LIBRARY_BACKLOG_PAGE_SIZE = 40;

export function libraryBacklogStatus(record: LibraryRecord): string {
  const { state, reviewStatus, queueForSchedule } = record.value;
  if (reviewStatus.ok && reviewStatus.value === 'Skipped') return 'Rejected';
  if (reviewStatus.ok && reviewStatus.value === 'Changes Requested') return 'Needs changes';
  if (reviewStatus.ok && reviewStatus.value === 'Approved') return queueForSchedule ? 'Queued for scheduling' : 'Approved';
  if (state.trim() === 'Editing') return 'Drafting';
  if (state.trim() && state.trim() !== 'Idea') return state.trim();
  return record.value.draftContent.trim() ? 'Drafting' : 'Needs review';
}

export function libraryBacklogView(rows: LibraryRecord[], filters: LibraryBacklogFilters) {
  const sources = [...new Set(rows.map((r) => r.value.contentSource.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const platforms = PLATFORMS.filter((p) => rows.some((r) => r.value.targetPlatform.ok && r.value.targetPlatform.value === p));
  const matches = rows.filter((r) =>
    (!filters.source || r.value.contentSource.trim() === filters.source) &&
    (!filters.platform || (r.value.targetPlatform.ok && r.value.targetPlatform.value === filters.platform)),
  );
  const totalPages = Math.max(1, Math.ceil(matches.length / LIBRARY_BACKLOG_PAGE_SIZE));
  const page = Math.min(Math.max(filters.page ?? 1, 1), totalPages);
  return { sources, platforms, total: matches.length, totalPages, page, rows: matches.slice((page - 1) * LIBRARY_BACKLOG_PAGE_SIZE, page * LIBRARY_BACKLOG_PAGE_SIZE) };
}
