import 'server-only';
import type { ScheduledFact } from '@/domain/backlog';
import type { ScheduleRecord } from '@/domain/records';
import { parseContentId } from '@/domain/schedule';
import { adaptationState } from '@/domain/zh-state';

/**
 * Library -> Schedule lineage (CS-014). Promotion writes `<markdown link>#lib=<Library ID>`
 * into the Schedule `Source MD / Drive Link` cell. Kept in its own module so both the
 * Ready queue and the Review queue can read it without importing each other.
 */
const LINEAGE = /#lib=([A-Za-z0-9][A-Za-z0-9._-]{0,63})$/;

export function lineageLibraryId(sourceLink: string): string | null {
  const m = LINEAGE.exec(sourceLink.trim());
  return m ? m[1]! : null;
}

export function scheduledRowsFor(libraryId: string, schedule: ScheduleRecord[]): ScheduleRecord[] {
  return schedule.filter((r) => lineageLibraryId(r.value.sourceLink) === libraryId);
}

/** Schedule rows promoted from a Library post, as backlog facts (UX redesign). */
export function scheduledFacts(libraryId: string, schedule: ScheduleRecord[]): ScheduledFact[] {
  const all = schedule.map((r) => r.value);
  const facts: ScheduledFact[] = [];
  for (const r of scheduledRowsFor(libraryId, schedule)) {
    const v = r.value;
    const parsed = parseContentId(v.contentId);
    if (!parsed) continue;
    const hasCopy = Boolean(v.hook.trim() || v.content.trim() || v.chineseContent.trim());
    facts.push({
      contentId: v.contentId,
      isoDate: parsed.isoDate,
      slot: parsed.slot,
      platform: parsed.platform,
      published: v.typefullyStatus.ok && v.typefullyStatus.value === 'Published',
      ...(parsed.platform === 'X' && hasCopy ? { zh: adaptationState(v, all) } : {}),
    });
  }
  return facts;
}
