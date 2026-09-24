import 'server-only';
import { z } from 'zod';
import { PLATFORMS, SHEET_WRITE_VALUE, type Platform } from '@/domain/enums';
import type { ErrorCode } from '@/domain/errors';
import { thumbFor } from '@/domain/next-steps';
import type { LibraryPatch } from '@/domain/mapping';
import { libraryIdSchema, operationIdSchema, revisionSchema, type Actor } from '@/domain/mutation';
import type { LibraryRecord } from '@/domain/records';
import type { ContentRepository } from './ports';

/**
 * Content Queue backlog (idea-stage rows, IDEA-BL-NNNN). Grouped by source the
 * way the Queue Summary tab reports them, and edited through the same
 * mutation envelope as Review transitions, just against `updateQueue`.
 */

export type BacklogItem = {
  libraryId: string;
  revision: string;
  row: number;
  hook: string;
  slug: string;
  /** So the queue side panel can open straight into an edit without a second, single-item read. */
  draftContent: string;
  thumb: ReturnType<typeof thumbFor>;
  /** So Approve/Skip persist across a reload instead of resetting to actionable every time. */
  reviewStatus: 'Pending' | 'Approved' | 'Skipped' | 'Changes Requested' | null;
  /** The Birdhouse framework stage, e.g. "Opinions" — already a Sheet column, not new. */
  pesto: string;
  /** Target Platform; null when the cell holds something the app does not recognise. */
  platform: Platform | null;
  /** The hook template/swipe the post was written from. */
  hookTemplate: string;
};

export type BacklogGroup = { source: string; total: number; items: BacklogItem[] };

/** Options for the Backlog filter bar, derived from what is actually in the Content Queue tab. */
export type BacklogFilterOptions = { sources: string[]; platforms: Platform[] };

export type BacklogFilters = { source?: string; platform?: Platform; approved?: boolean };

const UNCATEGORISED = 'Uncategorised';

function toBacklogItem(record: LibraryRecord): BacklogItem {
  const item = record.value;
  return {
    libraryId: item.libraryId,
    revision: record.revision,
    row: record.row,
    hook: item.currentHook,
    slug: item.slug,
    draftContent: item.draftContent,
    thumb: thumbFor(item.libraryId, item),
    reviewStatus: item.reviewStatus.ok ? item.reviewStatus.value : null,
    pesto: item.pesto,
    platform: item.targetPlatform.ok ? item.targetPlatform.value : null,
    hookTemplate: item.hookTemplate,
  };
}

function matchesFilters(record: LibraryRecord, source: string, f: BacklogFilters): boolean {
  if (f.source && f.source !== source) return false;
  if (f.platform && !(record.value.targetPlatform.ok && record.value.targetPlatform.value === f.platform)) return false;
  if (f.approved !== undefined) {
    const approved = record.value.reviewStatus.ok && record.value.reviewStatus.value === 'Approved';
    if (approved !== f.approved) return false;
  }
  return true;
}

/**
 * Every Content Queue row, grouped by `contentSource` (trimmed) and optionally
 * filtered by source, target platform or approved status. Rows with an empty
 * source land in a literal `Uncategorised` group at the end, so nothing silently
 * disappears. Groups are sorted by source name (Uncategorised last); items
 * within a group are sorted by libraryId. A group with no rows left after
 * filtering is dropped, not shown empty.
 */
export async function loadBacklogGroups(repo: ContentRepository, filters: BacklogFilters = {}): Promise<BacklogGroup[]> {
  const rows = await repo.listQueue();
  const bySource = new Map<string, LibraryRecord[]>();
  for (const record of rows) {
    const source = record.value.contentSource.trim();
    const key = source === '' ? UNCATEGORISED : source;
    const list = bySource.get(key);
    if (list) list.push(record);
    else bySource.set(key, [record]);
  }
  const named = [...bySource.keys()].filter((source) => source !== UNCATEGORISED).sort((a, b) => a.localeCompare(b));
  const order = bySource.has(UNCATEGORISED) ? [...named, UNCATEGORISED] : named;
  const groups: BacklogGroup[] = [];
  for (const source of order) {
    const items = bySource
      .get(source)!
      .filter((record) => matchesFilters(record, source, filters))
      .slice()
      .sort((a, b) => a.value.libraryId.localeCompare(b.value.libraryId))
      .map(toBacklogItem);
    if (items.length > 0) groups.push({ source, total: items.length, items });
  }
  return groups;
}

/** The full, unfiltered set of sources and platforms, for the filter bar's option lists. */
export async function loadBacklogFilterOptions(repo: ContentRepository): Promise<BacklogFilterOptions> {
  const rows = await repo.listQueue();
  const sources = new Set<string>();
  const platforms = new Set<Platform>();
  for (const record of rows) {
    const source = record.value.contentSource.trim();
    sources.add(source === '' ? UNCATEGORISED : source);
    if (record.value.targetPlatform.ok) platforms.add(record.value.targetPlatform.value);
  }
  return {
    sources: [...sources].filter((s) => s !== UNCATEGORISED).sort((a, b) => a.localeCompare(b)).concat(sources.has(UNCATEGORISED) ? [UNCATEGORISED] : []),
    platforms: PLATFORMS.filter((p) => platforms.has(p)),
  };
}

// ------------------------------------------------------------------ edits

export const backlogEditSchema = z.object({
  operationId: operationIdSchema,
  libraryId: libraryIdSchema,
  expectedRevision: revisionSchema,
  patch: z
    .object({
      currentHook: z.string().max(500).optional(),
      draftContent: z.string().max(50000).optional(),
      reviewStatus: z.enum(['Pending', 'Approved', 'Skipped']).optional(),
    })
    .refine((p) => Object.keys(p).length > 0, 'patch must set at least one field'),
});
export type BacklogEdit = z.infer<typeof backlogEditSchema>;

export type BacklogOutcome =
  | { ok: true; item: BacklogItem; revision: string; replayed: boolean }
  | { ok: false; code: ErrorCode; message?: string };

/** Owner-only, mirroring applyReviewTransition's actor check. */
export async function applyBacklogEdit(repo: ContentRepository, actor: Actor, t: BacklogEdit): Promise<BacklogOutcome> {
  if (actor.role !== 'owner') return { ok: false, code: 'FORBIDDEN' };
  const patch: LibraryPatch = {};
  if (t.patch.currentHook !== undefined) patch.currentHook = t.patch.currentHook;
  if (t.patch.draftContent !== undefined) patch.draftContent = t.patch.draftContent;
  if (t.patch.reviewStatus !== undefined) patch.reviewStatus = SHEET_WRITE_VALUE.review[t.patch.reviewStatus];

  const result = await repo.updateQueue({
    operationId: t.operationId,
    actor,
    target: { libraryId: t.libraryId },
    expectedRevision: t.expectedRevision,
    patch,
  });
  if (!result.ok) return { ok: false, code: result.code };
  return { ok: true, item: toBacklogItem(result.value), revision: result.value.revision, replayed: result.replayed };
}
