import 'server-only';
import { z } from 'zod';
import {
  COPYRIGHT_QA,
  DUPLICATE_QA,
  PLATFORMS,
  REVIEW_STATUSES,
  SHEET_WRITE_VALUE,
} from '@/domain/enums';
import type { ErrorCode } from '@/domain/errors';
import { evaluateLibraryGates, type Gate, type GateCode, type GateResult, type ScreenshotUse } from '@/domain/gates';
import { shortHash } from '@/domain/hash';
import type { LibraryPatch } from '@/domain/mapping';
import type { Actor, MutationResult } from '@/domain/mutation';
import type { LibraryItem, LibraryRecord, ScheduleRecord } from '@/domain/records';
import { formatApprovalNote } from '@/domain/stage';
import { formatVisualSource } from '@/domain/visual';
import { libraryNextStep, thumbFor } from '@/domain/next-steps';
import { backlogPills, postTab } from '@/domain/backlog';
import { LANES, LEGACY_LANES, type Lane, type ReviewCard, type ReviewQueue } from '@/domain/views';
import { scheduledFacts } from './lineage';
import type { ContentRepository } from './ports';

/**
 * Review Queue services (CS-007).
 *
 * The Sheet stays the authority: every list is computed from a fresh read, every
 * transition re-reads the row, re-runs the gate engine server-side and writes only
 * the named review fields with the caller's expected revision. Filters travel in
 * the URL as enums and hashed source keys only, never post text (SEC-10).
 */

export const PAGE_SIZE = 25;

export { LANES, LEGACY_LANES, type Lane, type ReviewCard, type ReviewQueue } from '@/domain/views';

const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .optional()
    .transform((v) => (v && (values as readonly string[]).includes(v) ? (v as T[number]) : undefined));

export const reviewFilterSchema = z.object({
  lane: optionalEnum(LANES),
  src: z
    .string()
    .optional()
    .transform((v) => (v && /^[0-9a-f]{8}$/.test(v) ? v : undefined)),
  target: optionalEnum(PLATFORMS),
  from: optionalEnum(PLATFORMS),
  review: optionalEnum(REVIEW_STATUSES),
  copyright: optionalEnum(COPYRIGHT_QA),
  duplicate: optionalEnum(DUPLICATE_QA),
  queue: optionalEnum(['queued', 'not_queued'] as const),
  page: z
    .string()
    .optional()
    .transform((v) => {
      const n = Number(v);
      return Number.isInteger(n) && n >= 1 && n <= 1000 ? n : 1;
    }),
});

export type ReviewFilters = z.infer<typeof reviewFilterSchema>;

export function parseReviewFilters(params: Record<string, string | string[] | undefined>): ReviewFilters {
  const flat = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  return reviewFilterSchema.parse(flat);
}

export function sourceKey(source: string): string {
  return shortHash(`source:${source.trim()}`);
}


function enumLabel(p: { ok: true; value: string } | { ok: false; raw: string }): string {
  return p.ok ? p.value : `Unrecognised: ${p.raw}`;
}

function laneOf(item: LibraryItem, gates: GateResult): ReviewCard['lane'] {
  const codes = new Set(gates.blockers.map((g) => g.code));
  if (codes.has('COPYRIGHT_REWORK')) return 'copyright';
  if (codes.has('DUPLICATE_CHECK') || codes.has('DUPLICATE_CONFIRMED')) return 'duplicate';
  if (item.reviewStatus.ok && item.reviewStatus.value === 'Approved') return 'approved';
  if (gates.status === 'blocked') return 'blocked';
  return 'clean';
}

/** Other uses of a screenshot, across Library and Schedule, excluding the item itself. */
export function screenshotUses(
  item: LibraryItem,
  library: LibraryRecord[],
  schedule: ScheduleRecord[],
): ScreenshotUse[] {
  if (item.visual.source.kind !== 'screenshot') return [];
  const id = item.visual.source.screenshotId;
  const uses: ScreenshotUse[] = [];
  for (const r of library) {
    const v = r.value;
    if (v.libraryId === item.libraryId) continue;
    if (v.visual.source.kind === 'screenshot' && v.visual.source.screenshotId === id && v.targetPlatform.ok) {
      uses.push({ platform: v.targetPlatform.value, libraryId: v.libraryId });
    }
  }
  for (const r of schedule) {
    const v = r.value;
    if (v.visual.source.kind === 'screenshot' && v.visual.source.screenshotId === id && v.platform?.ok) {
      uses.push({ platform: v.platform.value, contentId: v.contentId });
    }
  }
  return uses;
}

export function toCard(record: LibraryRecord, library: LibraryRecord[], schedule: ScheduleRecord[] | null): ReviewCard {
  const item = record.value;
  const uses = schedule === null && item.visual.source.kind === 'screenshot' ? null : screenshotUses(item, library, schedule ?? []);
  const gates = evaluateLibraryGates(item, { purpose: 'review', screenshotUses: uses });
  // The next step matches the board read model: an approved post is judged for release.
  const approvedNow = item.reviewStatus.ok && item.reviewStatus.value === 'Approved';
  const stepGates = approvedNow ? evaluateLibraryGates(item, { purpose: 'ready', zh: 'not_required', screenshotUses: uses }) : gates;
  const facts = schedule ? scheduledFacts(item.libraryId, schedule) : [];
  const step = libraryNextStep(stepGates, facts.length > 0);
  const thumb = thumbFor(item.libraryId, item);
  const text = item.draftContent;
  return {
    libraryId: item.libraryId,
    revision: record.revision,
    row: record.row,
    slug: item.slug,
    source: item.contentSource,
    sourceKey: sourceKey(item.contentSource),
    sourcePlatform: item.sourcePlatform ? enumLabel(item.sourcePlatform) : '',
    targetPlatform: enumLabel(item.targetPlatform),
    state: item.state,
    hook: item.currentHook,
    preview: text.length > 280 ? `${text.slice(0, 279)}…` : text,
    reviewStatus: enumLabel(item.reviewStatus),
    copyrightQa: enumLabel(item.copyrightQa),
    duplicateQa: enumLabel(item.duplicateQa),
    queued: item.queueForSchedule,
    visual: formatVisualSource(item.visual.source) || (item.visual.source.kind === 'invalid' ? 'Unrecognised' : 'Undecided'),
    imageStatus: enumLabel(item.visual.imageStatus),
    hasMarkdownLink: Boolean(record.links.sourceMarkdown || record.cells.sourceMarkdown.startsWith('https://')),
    lane: laneOf(item, gates),
    gates,
    thumb,
    step,
    tab: postTab(step, facts, stepGates.status),
    pills: backlogPills({
      gates: stepGates,
      reviewStatus: item.reviewStatus.ok ? item.reviewStatus.value : null,
      platform: item.targetPlatform.ok ? item.targetPlatform.value : '',
      thumb,
      scheduled: facts,
    }),
  };
}

function matches(card: ReviewCard, record: LibraryRecord, f: ReviewFilters): boolean {
  const item = record.value;
  if (f.lane && f.lane !== 'all') {
    const legacy = (LEGACY_LANES as readonly string[]).includes(f.lane);
    if (legacy ? card.lane !== f.lane : card.tab !== f.lane) return false;
  }
  if (f.src && card.sourceKey !== f.src) return false;
  if (f.target && !(item.targetPlatform.ok && item.targetPlatform.value === f.target)) return false;
  if (f.from && !(item.sourcePlatform?.ok && item.sourcePlatform.value === f.from)) return false;
  if (f.review && !(item.reviewStatus.ok && item.reviewStatus.value === f.review)) return false;
  if (f.copyright && !(item.copyrightQa.ok && item.copyrightQa.value === f.copyright)) return false;
  if (f.duplicate && !(item.duplicateQa.ok && item.duplicateQa.value === f.duplicate)) return false;
  if (f.queue === 'queued' && item.queueForSchedule !== true) return false;
  if (f.queue === 'not_queued' && item.queueForSchedule === true) return false;
  return true;
}


export async function loadReviewQueue(repo: ContentRepository, filters: ReviewFilters): Promise<ReviewQueue> {
  const library = await repo.listLibrary();
  let schedule: ScheduleRecord[] | null = null;
  try {
    schedule = await repo.listSchedule();
  } catch {
    schedule = null;
  }
  const all = library.map((r) => ({ record: r, card: toCard(r, library, schedule) }));
  const filtered = all.filter(({ card, record }) => matches(card, record, filters));
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(filters.page, pages);
  const sources = [...new Map(library.map((r) => [sourceKey(r.value.contentSource), r.value.contentSource])).entries()]
    .filter(([, label]) => label.trim() !== '')
    .map(([key, label]) => ({ key, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const laneCounts = Object.fromEntries(LANES.map((l) => [l, 0])) as Record<Lane, number>;
  for (const { card } of all) {
    laneCounts.all += 1;
    if (card.tab) laneCounts[card.tab] += 1;
    if (card.lane !== 'blocked') laneCounts[card.lane] += 1;
  }
  return {
    cards: filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((x) => x.card),
    total: filtered.length,
    totalUnfiltered: library.length,
    page,
    pages,
    sources,
    laneCounts,
    scheduleUnavailable: schedule === null,
  };
}

// ------------------------------------------------------------------ transitions

export const REVIEW_ACTIONS = ['approve', 'approve_and_queue', 'queue', 'unqueue', 'skip', 'request_changes', 'reopen'] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

/** Gates that make approval unsafe. Pending review is what approval resolves. */
const APPROVAL_BLOCKERS: ReadonlySet<GateCode> = new Set<GateCode>([
  'UNRECOGNISED_VALUE',
  'MISSING_IDENTITY',
  'COPYRIGHT_REWORK',
  'COPYRIGHT_UNCHECKED',
  'DUPLICATE_CHECK',
  'DUPLICATE_CONFIRMED',
  'DUPLICATE_UNCHECKED',
  'MISSING_COPY',
  'MISSING_SOURCE_LINK',
  'MARKDOWN_MISMATCH',
  'HOOK_MISSING',
  'REVIEW_SKIPPED',
  'VISUAL_UNDECIDED',
  'VISUAL_INVALID',
  'SCREENSHOT_REUSED',
  'SCREENSHOT_UNCERTAIN',
]);

export const reviewTransitionSchema = z.object({
  operationId: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/),
  libraryId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),
  expectedRevision: z.string().regex(/^[0-9a-f]{16}$/),
  action: z.enum(REVIEW_ACTIONS),
  note: z.string().max(200).optional(),
});
export type ReviewTransition = z.infer<typeof reviewTransitionSchema>;

export type TransitionOutcome =
  | { ok: true; card: ReviewCard; replayed: boolean }
  | { ok: false; code: ErrorCode; blockers?: Gate[]; current?: ReviewCard; message?: string };

export async function applyReviewTransition(repo: ContentRepository, actor: Actor, t: ReviewTransition): Promise<TransitionOutcome> {
  if (actor.role !== 'owner') return { ok: false, code: 'FORBIDDEN' };
  const library = await repo.listLibrary();
  const matchesId = library.filter((r) => r.value.libraryId === t.libraryId);
  if (matchesId.length !== 1) return { ok: false, code: matchesId.length === 0 ? 'NOT_FOUND' : 'CONFLICT' };
  const record = matchesId[0]!;
  let schedule: ScheduleRecord[] | null = null;
  try {
    schedule = await repo.listSchedule();
  } catch {
    schedule = null;
  }
  const current = toCard(record, library, schedule);
  if (record.revision !== t.expectedRevision) return { ok: false, code: 'STALE_READ', current };

  const item = record.value;
  const reviewValue = item.reviewStatus.ok ? item.reviewStatus.value : null;
  const patch: LibraryPatch = {};
  const canStamp = !record.formulaFields.includes('nextAction');

  switch (t.action) {
    case 'approve':
    case 'approve_and_queue': {
      const blockers = current.gates.blockers.filter((g) => APPROVAL_BLOCKERS.has(g.code));
      if (blockers.length > 0) return { ok: false, code: 'GATE_BLOCKED', blockers, current };
      patch.reviewStatus = SHEET_WRITE_VALUE.review.Approved;
      if (canStamp) patch.nextAction = formatApprovalNote(item);
      if (t.action === 'approve_and_queue') patch.queueForSchedule = 'TRUE';
      break;
    }
    case 'queue': {
      if (reviewValue !== 'Approved') {
        return { ok: false, code: 'GATE_BLOCKED', blockers: current.gates.blockers.filter((g) => g.code.startsWith('REVIEW')), current };
      }
      const stale = current.gates.blockers.find((g) => g.code === 'APPROVAL_STALE');
      if (stale) return { ok: false, code: 'GATE_BLOCKED', blockers: [stale], current };
      patch.queueForSchedule = 'TRUE';
      break;
    }
    case 'unqueue':
      patch.queueForSchedule = 'FALSE';
      break;
    case 'skip':
      patch.reviewStatus = SHEET_WRITE_VALUE.review.Skipped;
      patch.queueForSchedule = 'FALSE';
      if (canStamp) patch.nextAction = 'Skipped';
      break;
    case 'request_changes':
      patch.reviewStatus = SHEET_WRITE_VALUE.review['Changes Requested'];
      patch.queueForSchedule = 'FALSE';
      if (canStamp) patch.nextAction = t.note?.trim() ? `Changes requested: ${t.note.trim()}` : 'Changes requested';
      break;
    case 'reopen':
      patch.reviewStatus = SHEET_WRITE_VALUE.review.Pending;
      patch.queueForSchedule = 'FALSE';
      if (canStamp) patch.nextAction = 'Review';
      break;
  }

  const result: MutationResult<LibraryRecord> = await repo.updateLibrary({
    operationId: t.operationId,
    actor,
    target: { libraryId: t.libraryId },
    expectedRevision: t.expectedRevision,
    patch,
  });
  if (!result.ok) {
    if (result.code === 'STALE_READ') {
      const fresh = await repo.getLibrary(t.libraryId).catch(() => null);
      return { ok: false, code: 'STALE_READ', ...(fresh ? { current: toCard(fresh, library, schedule) } : {}) };
    }
    return { ok: false, code: result.code };
  }
  const refreshedLibrary = library.map((r) => (r.value.libraryId === t.libraryId ? result.value : r));
  return { ok: true, replayed: result.replayed, card: toCard(result.value, refreshedLibrary, schedule) };
}

