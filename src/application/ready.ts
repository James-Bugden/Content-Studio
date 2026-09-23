import 'server-only';
import { evaluateLibraryGates, type Gate } from '@/domain/gates';
import type { LibraryRecord, ScheduleRecord } from '@/domain/records';
import { formatVisualSource } from '@/domain/visual';
import type { ReadyItem, ReadyQueue } from '@/domain/views';

export type { ReadyItem, ReadyQueue };
import type { ContentRepository } from './ports';
import { screenshotUses } from './review';

/**
 * Ready Queue (CS-013).
 *
 * The Ready Queue tab is the Sheet's own derived view. Before showing anything
 * as Ready, every queue row is re-fetched from Content Library (the authority)
 * and re-evaluated by the gate engine (READY-06). A queue row with no matching
 * Library row is flagged, never trusted.
 *
 * Library -> Schedule lineage is written by promotion (CS-014) into the Schedule
 * `Source MD / Drive Link` cell as `<markdown link>#lib=<Library ID>`, so a
 * promoted item is recognised here as already scheduled.
 */


const LINEAGE = /#lib=([A-Za-z0-9][A-Za-z0-9._-]{0,63})$/;

export function lineageLibraryId(sourceLink: string): string | null {
  const m = LINEAGE.exec(sourceLink.trim());
  return m ? m[1]! : null;
}

export function lineageLink(markdownLink: string, libraryId: string): string {
  return `${markdownLink.replace(/#.*$/, '')}#lib=${libraryId}`;
}

export function scheduledRowsFor(libraryId: string, schedule: ScheduleRecord[]): ScheduleRecord[] {
  return schedule.filter((r) => lineageLibraryId(r.value.sourceLink) === libraryId);
}

export function evaluateReady(record: LibraryRecord, library: LibraryRecord[], schedule: ScheduleRecord[] | null): Omit<ReadyItem, 'viewDrift'> {
  const item = record.value;
  const platform = item.targetPlatform.ok ? item.targetPlatform.value : null;
  const gates = evaluateLibraryGates(item, {
    purpose: 'ready',
    // The zh-TW adaptation is made from the scheduled X row, so it is a Schedule
    // gate (SCHED-04), not a Library one. It is shown here as a downstream note.
    zh: 'not_required',
    screenshotUses: schedule === null && item.visual.source.kind === 'screenshot' ? null : screenshotUses(item, library, schedule ?? []),
  });
  const scheduled = schedule ? scheduledRowsFor(item.libraryId, schedule) : [];
  const notes: string[] = [];
  if (platform === 'X') notes.push('After scheduling, the Threads zh-TW adaptation must be made and reviewed before the Threads slot can publish.');
  if (schedule === null) notes.push('The Schedule could not be read, so screenshot reuse and existing slots are unconfirmed.');
  const group: ReadyItem['group'] = scheduled.length > 0 ? 'scheduled' : gates.status;
  const text = item.draftContent;
  return {
    libraryId: item.libraryId,
    revision: record.revision,
    slug: item.slug,
    source: item.contentSource,
    targetPlatform: platform ?? 'Unrecognised',
    hook: item.currentHook,
    preview: text.length > 280 ? `${text.slice(0, 279)}…` : text,
    visual: formatVisualSource(item.visual.source) || 'Undecided',
    gates,
    group,
    scheduledAs: scheduled.map((r) => ({ contentId: r.value.contentId, date: r.value.date, slot: r.value.slot })),
    notes,
  };
}

export async function loadReadyQueue(repo: ContentRepository): Promise<ReadyQueue> {
  const [queue, library] = await Promise.all([repo.listReadyQueue(), repo.listLibrary()]);
  let schedule: ScheduleRecord[] | null = null;
  try {
    schedule = await repo.listSchedule();
  } catch {
    schedule = null;
  }
  const byId = new Map(library.map((r) => [r.value.libraryId, r]));
  const items: ReadyItem[] = [];
  const orphans: string[] = [];
  for (const q of queue) {
    const source = byId.get(q.value.libraryId);
    if (!source) {
      orphans.push(q.value.libraryId);
      continue;
    }
    const evaluated = evaluateReady(source, library, schedule);
    // Drift: the view row shows different review/queue values than the Library row.
    const viewDrift = q.cells.reviewStatus !== source.cells.reviewStatus || q.cells.queueForSchedule !== source.cells.queueForSchedule || q.cells.draftContent !== source.cells.draftContent;
    items.push({ ...evaluated, viewDrift });
  }
  const counts = { ready: 0, needs_action: 0, blocked: 0, scheduled: 0 } as Record<ReadyItem['group'], number>;
  for (const i of items) counts[i.group] += 1;
  return { items, orphans, counts, scheduleUnavailable: schedule === null };
}

export type { Gate };
