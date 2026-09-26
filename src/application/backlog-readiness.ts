import 'server-only';
import type { LibraryRecord, ScheduleRecord } from '@/domain/records';
import { libraryBacklogStatus, type BacklogReadiness } from '@/domain/library-backlog';
import { slotNextStep } from '@/domain/next-steps';
import { adaptationState } from '@/domain/zh-state';
import { lineageLibraryId } from './lineage';
import { evaluateReady } from './ready';

/** The Sheet's derived Ready Queue is a candidate list, never an authority in
 * isolation. A row must match its Library source and pass the existing gates. */
export function backlogReadiness(
  library: LibraryRecord[], queue: LibraryRecord[] | null, schedule: ScheduleRecord[] | null,
): Map<string, BacklogReadiness> {
  const out = new Map<string, BacklogReadiness>();
  const byId = new Map(library.map((row) => [row.value.libraryId, row]));
  const scheduled = new Map<string, ScheduleRecord[]>();
  for (const row of schedule ?? []) {
    const id = lineageLibraryId(row.value.sourceLink);
    if (id) scheduled.set(id, [...(scheduled.get(id) ?? []), row]);
  }

  for (const row of library) {
    const label = libraryBacklogStatus(row);
    out.set(row.value.libraryId, {
      label,
      reason: label === 'Schedule requested' ? 'Waiting for the derived Ready Queue and release checks.' : `Review stage: ${label}.`,
      tone: label === 'Rejected' || label === 'Needs changes' ? 'blocked' : label === 'Approved' ? 'good' : 'attention',
    });
  }
  // Missing provider data fails closed; especially a screenshot reuse decision
  // cannot be called ready while Schedule is unavailable.
  if (!queue || !schedule) {
    for (const row of library) {
      if (row.value.queueForSchedule) out.set(row.value.libraryId, { label: 'Readiness unknown', reason: 'Ready Queue or Schedule could not be checked. Retry before sending.', tone: 'attention' });
    }
    return out;
  }
  for (const candidate of queue) {
    const source = byId.get(candidate.value.libraryId);
    if (!source) continue;
    const drift = candidate.cells.reviewStatus !== source.cells.reviewStatus || candidate.cells.queueForSchedule !== source.cells.queueForSchedule || candidate.cells.draftContent !== source.cells.draftContent;
    if (drift) {
      out.set(source.value.libraryId, { label: 'Needs reconciliation', reason: 'Ready Queue disagrees with Content Library.', tone: 'blocked' });
      continue;
    }
    const ready = evaluateReady(source, library, schedule);
    if (ready.group === 'ready') out.set(source.value.libraryId, { label: 'Ready to schedule', reason: 'Ready Queue and Library release checks agree. Pick a schedule slot before Typefully.', tone: 'good' });
    else if (source.value.queueForSchedule) out.set(source.value.libraryId, { label: 'Needs checks', reason: ready.gates.next?.message ?? 'Scheduling checks are incomplete.', tone: 'attention' });
  }

  const allPosts = schedule.map((r) => r.value);
  for (const [id, rows] of scheduled) {
    if (!byId.has(id)) continue;
    if (rows.length !== 1) {
      out.set(id, { label: 'Check schedule', reason: 'Several schedule rows refer to this Library post.', tone: 'attention' });
      continue;
    }
    const post = rows[0]!.value;
    const step = slotNextStep({ post, ...(post.platform?.ok && post.platform.value === 'X' ? { zh: adaptationState(post, allPosts) } : {}), past: false, staleSync: false });
    if (step.kind === 'send_to_typefully' && step.action === 'Send to Typefully') {
      const current = byId.get(id)!;
      const gates = evaluateReady(current, library, schedule).gates;
      if (gates.status === 'ready' && post.hook === current.value.currentHook && post.content === current.value.draftContent) {
        out.set(id, { label: 'Ready for Typefully', reason: step.why, tone: 'good' });
      } else {
        out.set(id, { label: 'Needs reconciliation', reason: gates.next?.message ?? 'The scheduled copy differs from the current Library post.', tone: 'blocked' });
      }
    } else {
      out.set(id, { label: 'In schedule', reason: step.why, tone: step.kind === 'fix_sheet' ? 'blocked' : 'attention' });
    }
  }
  return out;
}
