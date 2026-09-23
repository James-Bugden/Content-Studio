import 'server-only';
import type { Platform } from '@/domain/enums';
import { isAppError, type ErrorCode } from '@/domain/errors';
import { fingerprint } from '@/domain/hash';
import {
  findTemplate,
  formatHookAlternatives,
  formatHookTemplateCell,
  HOOK_TEMPLATES,
  hookAlternativeSchema,
  hookOutputSchema,
  hookProblems,
  type HookAlternative,
  type HookOutput,
} from '@/domain/hook-frameworks';
import type { LibraryPatch } from '@/domain/mapping';
import { libraryIdSchema, operationIdSchema, revisionSchema, type Actor, type MutationResult, type StepResult } from '@/domain/mutation';
import type { LibraryRecord } from '@/domain/records';
import { emit, targetHash } from '@/observability/events';
import { HOUSE_STYLE, SECURITY_RULES, wrapUntrusted } from './ai-prompt';
import { saveDraft } from './draft-save';
import { readSection } from './markdown-source';
import type { AiGateway, AiMeta, AiTask, ContentRepository, DriveGateway } from './ports';

/**
 * Hook review (CS-010 HOOK-01..05).
 *
 * Generation proposes exactly three alternatives and writes nothing. Selection is
 * explicit and version-bound: it re-reads the row and the Markdown section, refuses
 * anything generated for an older draft, replaces the opening that equals the
 * current hook, saves through the existing draft saga (Drive then Sheet) and then
 * writes the hook fields with the post-save revision. A failure after the draft
 * saved is reported as PARTIAL_FAILURE with truthful steps, and retrying the same
 * operation completes only what is missing.
 */
export type HookReference = { fileId: string; revision: string; text: string };
export type HookInput = { platform: Platform; currentHook: string; draft: string; references?: HookReference[] };

const MAX_REFERENCE_CHARS = 20_000;

export const HOOK_TASK: AiTask<HookOutput, HookInput> = {
  name: 'hooks',
  promptVersion: 'hooks.v1',
  maxOutputTokens: 12_000,
  system: [
    'You write alternative opening hooks for professional social posts about careers and hiring.',
    'Return exactly three alternatives. Each must be materially different from the current hook and from each other, and must fit the draft that follows it.',
    `Use only these templates (template id, framework, pattern): ${HOOK_TEMPLATES.map((t) => `${t.id} | ${t.framework} | ${t.pattern}`).join('; ')}.`,
    'framework must be the framework of the chosen template; hookType is the primary hook type.',
    'Score each alternative 0, 1 or 2 on specificity, tension (curiosity), audienceFit (audience and platform fit), credibility (evidence) and valuePromise. total must equal the sum of the five scores.',
    'For LinkedIn, include linkedinChecks: audience, roleOrKeyword and directRelevance booleans plus a short note.',
    'X allows long posts (X Premium); do not shorten a hook to fit 280 characters.',
    'Reference documents show frameworks only: never copy or closely paraphrase their examples.',
    HOUSE_STYLE,
    SECURITY_RULES,
  ].join('\n'),
  render: (input) =>
    [
      `Platform: ${input.platform}`,
      wrapUntrusted('current_hook', input.currentHook),
      wrapUntrusted('source_text', input.draft),
      ...(input.references ?? []).map((r, i) => wrapUntrusted('reference', r.text.slice(0, MAX_REFERENCE_CHARS), { n: i + 1 })),
    ].join('\n'),
  schema: hookOutputSchema,
  validate: (value, input) => hookProblems(value, input),
};

export type HookProposal = {
  id: string;
  libraryId: string;
  platform: Platform;
  /** Fingerprint of the exact draft the alternatives were generated for. */
  draftHash: string;
  currentHook: string;
  alternatives: HookAlternative[];
  /** Reference documents by id and revision only; their text is never stored. */
  references: { fileId: string; revision: string }[];
  meta: AiMeta;
};

export type HookGeneration = { ok: true; proposal: HookProposal } | { ok: false; code: ErrorCode; meta?: AiMeta };

export async function generateHooks(args: {
  ai: AiGateway;
  libraryId: string;
  platform: Platform;
  currentHook: string;
  draft: string;
  draftHash: string;
  references?: HookReference[];
  signal?: AbortSignal;
}): Promise<HookGeneration> {
  if (!libraryIdSchema.safeParse(args.libraryId).success) return { ok: false, code: 'VALIDATION_FAILED' };
  if (args.draft.length > 40_000 || args.currentHook.length > 2000 || (args.references?.length ?? 0) > 10) return { ok: false, code: 'VALIDATION_FAILED' };
  if (fingerprint(args.draft) !== args.draftHash) return { ok: false, code: 'STALE_READ' };
  const input: HookInput = {
    platform: args.platform,
    currentHook: args.currentHook,
    draft: args.draft,
    ...(args.references ? { references: args.references } : {}),
  };
  const result = await args.ai.run(HOOK_TASK, input, args.signal ? { signal: args.signal } : {});
  if (!result.ok) return { ok: false, code: result.code, meta: result.meta };
  return {
    ok: true,
    proposal: {
      id: `hk_${fingerprint(JSON.stringify([args.libraryId, args.draftHash, HOOK_TASK.promptVersion, result.value.alternatives]))}`,
      libraryId: args.libraryId,
      platform: args.platform,
      draftHash: args.draftHash,
      currentHook: args.currentHook,
      alternatives: result.value.alternatives,
      references: (args.references ?? []).map((r) => ({ fileId: r.fileId, revision: r.revision })),
      meta: result.meta,
    },
  };
}

// ------------------------------------------------------------------ selection

export type HookChoice = { kind: 'current' } | { kind: 'alternative'; index: number; alternative: HookAlternative };

export type SelectHookInput = {
  operationId: string;
  libraryId: string;
  expectedSheetRevision: string;
  expectedSectionHash: string;
  /** `draftHash` of the proposal the choice came from. */
  generationDraftHash: string;
  choice: HookChoice;
  alternatives: HookAlternative[];
};

export type SelectHookResult = MutationResult<{ record: LibraryRecord }>;

function sameAlternative(a: HookAlternative, b: HookAlternative): boolean {
  return JSON.stringify(hookAlternativeSchema.parse(a)) === JSON.stringify(hookAlternativeSchema.parse(b));
}

export async function selectHook(repo: ContentRepository, drive: DriveGateway, actor: Actor, input: SelectHookInput): Promise<SelectHookResult> {
  const op = input.operationId;
  const steps: StepResult[] = [];
  const finish = (r: SelectHookResult): SelectHookResult => {
    emit({
      name: 'hook.select',
      adapter: 'app',
      outcome: r.ok ? (r.replayed ? 'replayed' : 'ok') : r.code === 'PARTIAL_FAILURE' ? 'partial' : r.code === 'STALE_READ' || r.code === 'CONFLICT' ? 'conflict' : 'error',
      ...(operationIdSchema.safeParse(op).success ? { operationId: op } : {}),
      targetHash: targetHash(input.libraryId),
      ...(r.ok ? {} : { code: r.code }),
      facts: { choice: input.choice.kind },
    });
    return r;
  };
  const fail = (code: ErrorCode, details?: Record<string, unknown>): SelectHookResult =>
    finish({ ok: false, operationId: op, code, steps: [...steps], ...(details ? { details } : {}) });

  if (actor.role !== 'owner') return fail('FORBIDDEN');
  if (
    !operationIdSchema.safeParse(op).success ||
    !libraryIdSchema.safeParse(input.libraryId).success ||
    !revisionSchema.safeParse(input.expectedSheetRevision).success ||
    !revisionSchema.safeParse(input.expectedSectionHash).success ||
    !revisionSchema.safeParse(input.generationDraftHash).success
  ) {
    return fail('VALIDATION_FAILED', { reason: 'invalid_input' });
  }
  const alts = hookOutputSchema.safeParse({ alternatives: input.alternatives });
  if (!alts.success || alts.data.alternatives.length !== 3) return fail('VALIDATION_FAILED', { reason: 'alternatives' });
  let chosen: HookAlternative | null = null;
  if (input.choice.kind === 'alternative') {
    const { index, alternative } = input.choice;
    const listed = alts.data.alternatives[index];
    const parsed = hookAlternativeSchema.safeParse(alternative);
    if (!listed || !parsed.success || !sameAlternative(listed, parsed.data)) return fail('VALIDATION_FAILED', { reason: 'choice_not_in_alternatives' });
    if (!findTemplate(parsed.data.template)) return fail('VALIDATION_FAILED', { reason: 'template_not_in_catalogue' });
    chosen = parsed.data;
  }

  let record: LibraryRecord;
  try {
    record = await repo.getLibrary(input.libraryId);
  } catch (error) {
    return fail(isAppError(error) ? error.code : 'PROVIDER_UNAVAILABLE');
  }
  const read = await readSection(drive, record);
  if (!read.ok) return fail(read.code, { reason: read.reason });
  const body = read.section.body;
  const alternativesCell = formatHookAlternatives(alts.data.alternatives);

  const hookPatch = (c: HookAlternative): LibraryPatch => {
    const t = findTemplate(c.template)!;
    return {
      currentHook: c.text,
      hookTemplate: formatHookTemplateCell(t),
      hookScore: String(c.total),
      hookType: c.hookType,
      hookAlternatives: alternativesCell,
    };
  };

  const writeHookFields = async (patch: LibraryPatch, expectedRevision: string, afterDraftSaved: boolean): Promise<SelectHookResult> => {
    const res = await repo.updateLibrary({
      operationId: `${op}_hook`.slice(0, 80),
      actor,
      target: { libraryId: input.libraryId },
      expectedRevision,
      patch,
    });
    if (!res.ok) {
      steps.push({ step: 'write hook fields to Sheet', provider: 'sheet', status: 'failed', errorCode: res.code });
      return fail(afterDraftSaved ? 'PARTIAL_FAILURE' : res.code, afterDraftSaved ? { reason: 'hook_fields_not_written' } : undefined);
    }
    steps.push({ step: 'write hook fields to Sheet', provider: 'sheet', status: res.replayed ? 'skipped_already_applied' : 'done', revision: res.value.revision });
    return finish({ ok: true, operationId: op, replayed: false, value: { record: res.value }, steps: [...steps] });
  };

  // Resume or replay after an earlier partial run of this selection: the draft
  // already opens with the chosen hook, so only the hook fields may be missing.
  if (chosen && body.startsWith(chosen.text) && record.value.draftContent === body && fingerprint(body) !== input.generationDraftHash) {
    steps.push({ step: 'save draft with new opening', provider: 'drive', status: 'skipped_already_applied', revision: read.meta.revision });
    // The hook fields are written in one Sheet write. If Current Hook already holds
    // the choice, that write landed: this is a replay, and nothing is written, so
    // any later hand edit to Hook Score or Hook Type is kept (review finding 2).
    if (record.cells.currentHook === chosen.text) {
      steps.push({ step: 'write hook fields to Sheet', provider: 'sheet', status: 'skipped_already_applied', revision: record.revision });
      return finish({ ok: true, operationId: op, replayed: true, value: { record }, steps: [...steps] });
    }
    // Otherwise resume only from the exact state the partial run left: the Sheet
    // still holds the original hook the generation was made against.
    if (fingerprint(record.cells.currentHook + body.slice(chosen.text.length)) !== input.generationDraftHash) {
      return fail('STALE_READ', { provider: 'sheet', currentRevision: record.revision });
    }
    return writeHookFields(hookPatch(chosen), record.revision, true);
  }

  // HOOK-05: a generation or selection made for an older draft or row cannot land.
  if (fingerprint(body) !== input.generationDraftHash || read.section.bodyHash !== input.expectedSectionHash) {
    return fail('STALE_READ', { provider: 'drive' });
  }
  if (record.revision !== input.expectedSheetRevision) return fail('STALE_READ', { provider: 'sheet', currentRevision: record.revision });

  if (!chosen) {
    // Keeping the current hook records the alternatives that were considered, nothing else.
    return writeHookFields({ hookAlternatives: alternativesCell }, record.revision, false);
  }

  const current = record.value.currentHook;
  const rest = body.slice(current.length);
  if (current.trim() === '' || !body.startsWith(current) || !(rest === '' || rest.startsWith('\n') || rest.startsWith('\r\n'))) {
    return fail('CONFLICT', { reason: 'opening_mismatch' });
  }
  if (record.value.draftContent !== body) return fail('CONFLICT', { reason: 'markdown_mismatch' });

  const saved = await saveDraft(repo, drive, {
    operationId: `${op}_draft`.slice(0, 80),
    actor,
    libraryId: input.libraryId,
    expectedSheetRevision: record.revision,
    expectedSectionHash: read.section.bodyHash,
    proposed: chosen.text + rest,
  });
  steps.push(...saved.steps);
  if (!saved.ok) return fail(saved.code, saved.details);
  return writeHookFields(hookPatch(chosen), saved.value.record.revision, true);
}
