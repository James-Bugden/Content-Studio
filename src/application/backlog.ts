import 'server-only';
import { z } from 'zod';
import { SHEET_WRITE_VALUE } from '@/domain/enums';
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
};

export type BacklogGroup = { source: string; total: number; items: BacklogItem[] };

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
  };
}

/**
 * Every Content Queue row, grouped by `contentSource` (trimmed). Rows with an
 * empty source land in a literal `Uncategorised` group at the end, so nothing
 * silently disappears. Groups are sorted by source name (Uncategorised last);
 * items within a group are sorted by libraryId.
 */
export async function loadBacklogGroups(repo: ContentRepository): Promise<BacklogGroup[]> {
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
  return order.map((source) => {
    const items = bySource
      .get(source)!
      .slice()
      .sort((a, b) => a.value.libraryId.localeCompare(b.value.libraryId))
      .map(toBacklogItem);
    return { source, total: items.length, items };
  });
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
