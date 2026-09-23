import 'server-only';
import { CONTENT_STAGES } from '@/domain/enums';
import { AppError } from '@/domain/errors';
import type { ScheduledPost, ScheduleRecord } from '@/domain/records';
import type { AdaptationBlocker, AdaptationThreads, AdaptationView } from '@/domain/views';
import { adaptationState, resolveThreadsRow } from '@/domain/zh-state';
import type { ContentRepository } from './ports';
import { checkEligibility } from './zh-tw';

/**
 * Read model for the X to Threads zh-TW page (CS-011). Everything is derived from
 * the current Schedule rows on every read, so the page and the write services
 * agree on eligibility, the linked Threads row and freshness.
 */
const EN_APPROVED_INDEX = CONTENT_STAGES.indexOf('EN Approved');

function stageText(p: ScheduledPost): string {
  if (!p.contentStage) return '';
  return p.contentStage.ok ? p.contentStage.value : p.contentStage.raw;
}

/** Every reason the X row cannot be adapted yet, in words (checkEligibility stays the authority). */
export function eligibilityBlockers(x: ScheduledPost): AdaptationBlocker[] {
  const out: AdaptationBlocker[] = [];
  if (!(x.platform?.ok && x.platform.value === 'X')) {
    out.push({ code: 'not_x', message: 'This row is not an X post. Only approved X copy can be adapted for Threads.' });
  }
  if (!x.contentStage) {
    out.push({ code: 'stage_missing', message: 'No content stage is set. The X copy must reach EN Approved first.' });
  } else if (!x.contentStage.ok) {
    out.push({ code: 'stage_unrecognised', message: 'The content stage is not one Content Studio recognises. Correct it in the Sheet.' });
  } else if (CONTENT_STAGES.indexOf(x.contentStage.value) < EN_APPROVED_INDEX) {
    out.push({ code: 'not_en_approved', message: `The X copy is at ${x.contentStage.value}, not EN Approved yet.` });
  }
  if (x.hook.trim() === '') out.push({ code: 'missing_hook', message: 'The X hook is empty.' });
  if (x.content.trim() === '') out.push({ code: 'missing_content', message: 'The X content is empty.' });
  // Belt and braces: if the authoritative check refuses for a reason not listed above, say so.
  const eligible = checkEligibility(x);
  if (!eligible.ok && out.length === 0) out.push({ code: eligible.reason, message: 'The X copy is not eligible for adaptation yet.' });
  return out;
}

export async function loadAdaptationView(repo: ContentRepository, contentId: string): Promise<AdaptationView> {
  const all: ScheduleRecord[] = await repo.listSchedule();
  const matches = all.filter((r) => r.value.contentId === contentId);
  if (matches.length === 0) throw new AppError('NOT_FOUND', { reason: 'source_not_found' });
  if (matches.length > 1) throw new AppError('CONFLICT', { reason: 'duplicate_id' });
  const x = matches[0]!;
  const rows = all.map((r) => r.value);
  const resolved = resolveThreadsRow(x.value.contentId, rows);
  let threads: AdaptationThreads;
  if (resolved.kind === 'found') {
    const rec = all.find((r) => r.value === resolved.post)!;
    threads = {
      kind: 'found',
      contentId: rec.value.contentId,
      revision: rec.revision,
      date: rec.value.date,
      slot: rec.value.slot,
      hook: rec.value.hook,
      chineseContent: rec.value.chineseContent,
      stage: stageText(rec.value),
    };
  } else {
    threads = resolved.kind === 'ambiguous' ? { kind: 'ambiguous', candidates: resolved.candidates } : { kind: 'none' };
  }
  return {
    source: {
      contentId: x.value.contentId,
      revision: x.revision,
      date: x.value.date,
      slot: x.value.slot,
      platform: x.value.platform ? (x.value.platform.ok ? x.value.platform.value : x.value.platform.raw) : '',
      stage: stageText(x.value),
      hook: x.value.hook,
      content: x.value.content,
    },
    blockers: eligibilityBlockers(x.value),
    state: adaptationState(x.value, rows),
    threads,
  };
}
