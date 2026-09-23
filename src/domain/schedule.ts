import { SLOTS, type Platform, type Slot } from './enums';
import type { LibraryRecord, ScheduleRecord, WorkflowSettings } from './records';
import { SCHEDULE_HEADERS, type ScheduleField } from './sheet-schema';
import type { SchedulePatch } from './mapping';

/**
 * Schedule rules (CS-014). Pure and timezone-independent: dates come from the
 * Content ID (`YYYY-MM-DD-<SLOT>-<X|TH|LI>`), never from parsing a display date
 * in the browser's local time, and every time is a Taipei wall-clock string.
 */
const CONTENT_ID = /^(\d{4})-(\d{2})-(\d{2})-(MAIN|2ND|3RD)-(X|TH|LI)$/;
const SUFFIX_PLATFORM: Record<string, Platform> = { X: 'X', TH: 'Threads', LI: 'LinkedIn' };
const SLOT_OF: Record<string, Slot> = { MAIN: 'Main', '2ND': '2nd', '3RD': '3rd' };

export type ParsedContentId = { isoDate: string; slot: Slot; platform: Platform };

/** Forward-looking scheduling has 5 active rows/day. Third slots remain parseable only for legacy history. */
export function isActiveScheduleSlot(platform: Platform, slot: Slot): boolean {
  if (slot === '3rd') return false;
  if (platform === 'LinkedIn') return slot === 'Main';
  return slot === 'Main' || slot === '2nd';
}

export function parseContentId(contentId: string): ParsedContentId | null {
  const m = CONTENT_ID.exec(contentId.trim());
  if (!m) return null;
  return { isoDate: `${m[1]}-${m[2]}-${m[3]}`, slot: SLOT_OF[m[4]!]!, platform: SUFFIX_PLATFORM[m[5]!]! };
}

/** Monday (ISO week start) of the week containing an ISO date, computed in UTC arithmetic. */
export function weekStart(isoDate: string): string {
  const [y, mo, d] = isoDate.split('-').map(Number) as [number, number, number];
  const t = Date.UTC(y, mo - 1, d);
  const dow = new Date(t).getUTCDay(); // 0 Sunday
  const back = (dow + 6) % 7;
  return new Date(t - back * 86_400_000).toISOString().slice(0, 10);
}

export function addDays(isoDate: string, days: number): string {
  const [y, mo, d] = isoDate.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, mo - 1, d) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Today's date in Taipei, whatever timezone the server or browser runs in. */
export function taipeiToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function slotOrder(slot: string): number {
  const i = (SLOTS as readonly string[]).indexOf(slot);
  return i < 0 ? 99 : i;
}

const CONTENT_FIELDS: ScheduleField[] = ['hook', 'content', 'chineseContent', 'finalContent', 'typefullyDraftId', 'postLink', 'publishedAt'];

/** True when a legacy slot contains real work/state and therefore must stay visible/reconcilable. */
export function hasScheduleActivity(row: ScheduleRecord): boolean {
  const v = row.value;
  if (v.posted === true) return true;
  if (CONTENT_FIELDS.some((f) => Boolean(row.cells[f]?.trim()))) return true;
  if (v.typefullyStatus.ok && v.typefullyStatus.value !== 'Not Sent') return true;
  if (!v.typefullyStatus.ok) return true;
  return v.contentStage !== null;
}

export type SlotAvailability = { available: true } | { available: false; reason: string };

/** A pre-created slot row is available only when nothing has been placed in it. */
export function slotAvailability(row: ScheduleRecord): SlotAvailability {
  const v = row.value;
  const parsed = parseContentId(v.contentId);
  if (!parsed) return { available: false, reason: 'This row has no standard Content ID.' };
  if (!isActiveScheduleSlot(parsed.platform, parsed.slot)) return { available: false, reason: 'Legacy 3rd slots are deprecated and cannot receive new content.' };
  if (v.posted === true) return { available: false, reason: 'Already posted.' };
  for (const f of CONTENT_FIELDS) {
    if (row.cells[f]?.trim()) return { available: false, reason: `Already holds ${SCHEDULE_HEADERS[f]}.` };
  }
  if (v.typefullyStatus.ok && v.typefullyStatus.value !== 'Not Sent') return { available: false, reason: `Typefully status is ${v.typefullyStatus.value}.` };
  if (!v.typefullyStatus.ok) return { available: false, reason: 'Typefully Status is unrecognised.' };
  if (v.contentStage !== null) return { available: false, reason: 'Content Stage is already set.' };
  return { available: true };
}

export type PreviewRow = { field: ScheduleField; header: string; before: string; after: string };

export type PromotionPlan =
  | { ok: true; patch: SchedulePatch; preview: PreviewRow[]; slotTime: string }
  | { ok: false; problems: string[] };

/**
 * Map an approved Library item onto an available Schedule slot row. Only the
 * fields listed here are ever written (SCHED-02); anything else in the row is
 * untouched. Lineage goes into `Source MD / Drive Link` as `#lib=<Library ID>`.
 */
export function planPromotion(
  library: LibraryRecord,
  row: ScheduleRecord,
  settings: WorkflowSettings,
  markdownLink: string,
): PromotionPlan {
  const problems: string[] = [];
  const item = library.value;
  const target = item.targetPlatform.ok ? item.targetPlatform.value : null;
  const parsed = parseContentId(row.value.contentId);
  if (!target) problems.push('The Library row has an unrecognised target platform.');
  if (target === 'Threads') problems.push('Threads rows are filled from the approved X post through the zh-TW adaptation, not promoted directly.');
  if (!parsed) problems.push('The Schedule row has no standard Content ID.');
  if (parsed && target && parsed.platform !== target) problems.push(`This slot is for ${parsed.platform}, not ${target}.`);
  const availability = slotAvailability(row);
  if (!availability.available) problems.push(`The slot is not available: ${availability.reason}`);

  const policy = parsed ? settings.slots.find((s) => s.platform === parsed.platform && s.slot === parsed.slot) : undefined;
  if (parsed && !policy) problems.push(`Workflow Settings has no time for ${parsed.platform} ${parsed.slot}.`);
  if (policy?.time === 'TBD') problems.push(`${policy.platform} ${policy.slot} is TBD in Workflow Settings and cannot be scheduled automatically.`);
  const rowTime = row.value.publishTime.trim();
  if (policy && policy.time !== 'TBD' && rowTime && rowTime !== policy.time) {
    problems.push(`The row time ${rowTime} differs from Workflow Settings (${policy.time}). Fix one of them first.`);
  }
  if (!markdownLink) problems.push('The Library row has no Markdown link for lineage.');
  if (problems.length > 0 || !parsed || !policy || !target) return { ok: false, problems };

  const lineage = `${markdownLink.replace(/#.*$/, '')}#lib=${item.libraryId}`;
  const patch: SchedulePatch = {
    hook: item.currentHook,
    content: item.draftContent,
    hookTemplate: item.hookTemplate,
    hookAlternatives: item.hookAlternatives,
    hookScore: item.hookScore === null ? '' : String(item.hookScore),
    hookType: item.hookType,
    pesto: item.pesto,
    funnelStage: item.funnelStage,
    contentStage: target === 'X' ? 'EN Approved' : 'Ready',
    typefullyStatus: 'Not Sent',
    sourceLink: lineage,
    visualSource: library.cells.visualSource,
    imageStatus: library.cells.imageStatus,
    imageBrief: library.cells.imageBrief,
    imageFile: library.cells.imageFile,
    imageAltText: library.cells.imageAltText,
    visualVersion: library.cells.visualVersion,
  };
  if (!rowTime) patch.publishTime = policy.time;
  // Never write a formula cell, and drop no-op writes so the preview is honest.
  for (const f of Object.keys(patch) as ScheduleField[]) {
    if (row.formulaFields.includes(f) || row.cells[f] === patch[f]) delete patch[f];
  }
  const preview = (Object.keys(patch) as ScheduleField[]).map((f) => ({ field: f, header: SCHEDULE_HEADERS[f], before: row.cells[f] ?? '', after: patch[f] ?? '' }));
  return { ok: true, patch, preview, slotTime: policy.time };
}
