import 'server-only';
import type { Platform } from '@/domain/enums';
import type { ErrorCode } from '@/domain/errors';
import { fingerprint } from '@/domain/hash';
import { contentIdSchema, libraryIdSchema, operationIdSchema, revisionSchema, type Actor, type MutationResult } from '@/domain/mutation';
import {
  englishQaOutputSchema,
  qaProblems,
  relocateFindings,
  type EnglishQaOutput,
  type QaProposal,
} from '@/domain/proposals';
import type { ScheduleRecord } from '@/domain/records';
import { emit, targetHash } from '@/observability/events';
import { HOUSE_STYLE, SECURITY_RULES, wrapUntrusted } from './ai-prompt';
import type { AiGateway, AiMeta, AiTask, ContentRepository } from './ports';

/**
 * English QA (CS-009 ENQA-01..03).
 *
 * Findings are advisory proposals bound to the fingerprint of the exact draft. The
 * draft is never rewritten here: the editor applies one finding at a time with the
 * pure `applyFinding` (src/domain/proposals.ts). Only an explicit confirmation
 * writes a summary, and only to Schedule `AI Review Notes`.
 */
export type EnglishQaInput = { draft: string; platform: Platform };

export const MAX_QA_DRAFT_CHARS = 40_000;

export const ENGLISH_QA_TASK: AiTask<EnglishQaOutput, EnglishQaInput> = {
  name: 'english_qa',
  promptVersion: 'english_qa.v1',
  maxOutputTokens: 16_000,
  system: [
    'You are an English copy editor for short professional social posts about careers and hiring.',
    'Report problems as findings; never rewrite the whole post.',
    'Categories: spelling, grammar, punctuation, banned_word, clarity, voice, factual_consistency, platform_fit.',
    'Each finding names an exact range in the draft: start and end are UTF-16 code unit offsets into the text between the source_text tags (the first character after the opening newline is offset 0), end is exclusive, and original must equal that slice exactly.',
    'Give a replacement for only that range, or null when the fix needs the author. Ranges must not overlap and ids must be unique (f1, f2, ...).',
    'Severity: must (wrong or banned), should (house style), consider (judgement).',
    'Platform fit: X allows 25,000 characters (X Premium), so never flag an X post for exceeding 280; LinkedIn allows 3,000.',
    'The summary is two or three actionable sentences for the author and must not quote the post.',
    HOUSE_STYLE,
    SECURITY_RULES,
  ].join('\n'),
  render: (input) => [`Platform: ${input.platform}`, 'Check this draft:', wrapUntrusted('source_text', input.draft)].join('\n'),
  schema: englishQaOutputSchema,
  normalise: (value, input) => relocateFindings(value, input.draft),
  validate: (value, input) => qaProblems(value, input.draft),
};

export type EnglishQaRun =
  | { ok: true; proposal: QaProposal & { libraryId: string; platform: Platform; meta: AiMeta } }
  | { ok: false; code: ErrorCode; meta?: AiMeta };

export async function runEnglishQa(args: {
  ai: AiGateway;
  libraryId: string;
  draft: string;
  draftHash: string;
  platform: Platform;
  signal?: AbortSignal;
}): Promise<EnglishQaRun> {
  if (!libraryIdSchema.safeParse(args.libraryId).success) return { ok: false, code: 'VALIDATION_FAILED' };
  if (typeof args.draft !== 'string' || args.draft.trim() === '' || args.draft.length > MAX_QA_DRAFT_CHARS) return { ok: false, code: 'VALIDATION_FAILED' };
  // Bind to the exact text: a hash that does not describe this draft is refused.
  if (fingerprint(args.draft) !== args.draftHash) return { ok: false, code: 'STALE_READ' };
  const result = await args.ai.run(ENGLISH_QA_TASK, { draft: args.draft, platform: args.platform }, args.signal ? { signal: args.signal } : {});
  if (!result.ok) return { ok: false, code: result.code, meta: result.meta };
  const findings = [...result.value.findings].sort((a, b) => a.start - b.start);
  return {
    ok: true,
    proposal: {
      id: `qa_${fingerprint(JSON.stringify([args.libraryId, args.draftHash, ENGLISH_QA_TASK.promptVersion, findings]))}`,
      draftHash: args.draftHash,
      findings,
      summary: result.value.summary,
      libraryId: args.libraryId,
      platform: args.platform,
      meta: result.meta,
    },
  };
}

/**
 * Write an actionable QA summary to Schedule `AI Review Notes` after explicit
 * confirmation. The Library tab has no notes column, so a Library-only item is
 * refused rather than written somewhere else.
 */
export async function saveQaNotes(
  repo: ContentRepository,
  actor: Actor,
  input: { operationId: string; contentId?: string; libraryId?: string; expectedRevision: string; summary: string },
): Promise<MutationResult<ScheduleRecord>> {
  const op = input.operationId;
  const fail = (code: ErrorCode, details?: Record<string, unknown>): MutationResult<ScheduleRecord> => {
    emit({ name: 'qa.notes.save', adapter: 'app', outcome: 'error', ...(operationIdSchema.safeParse(op).success ? { operationId: op } : {}), code });
    return { ok: false, operationId: op, code, steps: [], ...(details ? { details } : {}) };
  };
  if (actor.role !== 'owner') return fail('FORBIDDEN');
  if (!input.contentId) return fail('VALIDATION_FAILED', { reason: input.libraryId ? 'no_schedule_row' : 'missing_target' });
  if (!contentIdSchema.safeParse(input.contentId).success || !revisionSchema.safeParse(input.expectedRevision).success) {
    return fail('VALIDATION_FAILED', { reason: 'invalid_input' });
  }
  const summary = typeof input.summary === 'string' ? input.summary.trim() : '';
  if (summary === '' || summary.length > 2000) return fail('VALIDATION_FAILED', { reason: 'summary_length' });
  const result = await repo.updateSchedule({
    operationId: op,
    actor,
    target: { contentId: input.contentId },
    expectedRevision: input.expectedRevision,
    patch: { aiReviewNotes: summary },
  });
  emit({
    name: 'qa.notes.save',
    adapter: 'app',
    outcome: result.ok ? (result.replayed ? 'replayed' : 'ok') : 'error',
    operationId: op,
    targetHash: targetHash(input.contentId),
    ...(result.ok ? {} : { code: result.code }),
  });
  return result;
}
