import 'server-only';
import { SHEET_WRITE_VALUE } from '@/domain/enums';
import { isAppError, type ErrorCode } from '@/domain/errors';
import { fingerprint } from '@/domain/hash';
import { findSection, safeReplaceSectionBody, sectionBodyProblems } from '@/domain/markdown';
import type { LibraryPatch } from '@/domain/mapping';
import type { Actor, MutationResult, StepResult } from '@/domain/mutation';
import type { LibraryRecord } from '@/domain/records';
import { emit, targetHash } from '@/observability/events';
import { readSection } from './markdown-source';
import type { ContentRepository, DriveGateway } from './ports';

/**
 * Draft save saga (CS-004 DRV-03, CS-008 REV-07/08, DRV-04).
 *
 * Two providers, no shared transaction, so this is a saga with truthful steps:
 *
 *   1. Drive: replace only the Library-ID section body in the master Markdown.
 *   2. Sheet: mirror the exact text into `Draft Content`, and reset an existing
 *      approval to `Not Reviewed` because the approved text changed.
 *
 * Each step is idempotent: if the target already holds the proposed text the step
 * is reported as `skipped_already_applied`, so retrying the same operation after a
 * partial failure completes only what is missing and never duplicates a write.
 *
 * Conflicts are detected per provider against what the editor loaded:
 * - Sheet: row revision; a changed row whose draft is not already ours is STALE_READ.
 * - Drive: section hash; the file may have changed elsewhere (other sections), which
 *   is fine because only our section is replaced on the fresh text. A changed
 *   section is STALE_READ. Nothing is ever auto-merged.
 */
export type DraftSaveInput = {
  operationId: string;
  actor: Actor;
  libraryId: string;
  expectedSheetRevision: string;
  /** Hash of the Markdown section body the editor loaded. */
  expectedSectionHash: string;
  proposed: string;
};

export type DraftConflict = {
  provider: 'sheet' | 'drive';
  /** Current authoritative text, returned so the editor can show base/current/proposed. */
  current: string;
  currentRevision: string;
};

export type DraftSaveValue = { record: LibraryRecord; sectionHash: string; driveRevision: string };

export type DraftSaveResult = MutationResult<DraftSaveValue> & { conflict?: DraftConflict };

const MAX_DRAFT_CHARS = 40_000;

export async function saveDraft(repo: ContentRepository, drive: DriveGateway, input: DraftSaveInput): Promise<DraftSaveResult> {
  const steps: StepResult[] = [];
  const op = input.operationId;
  const finish = (r: DraftSaveResult): DraftSaveResult => {
    emit({
      name: 'draft.save',
      adapter: 'app',
      outcome: r.ok ? (r.replayed ? 'replayed' : 'ok') : r.code === 'PARTIAL_FAILURE' ? 'partial' : r.code === 'STALE_READ' ? 'conflict' : 'error',
      operationId: op,
      targetHash: targetHash(input.libraryId),
      ...(r.ok ? {} : { code: r.code }),
    });
    return r;
  };
  const fail = (code: ErrorCode, extra: Partial<DraftSaveResult> = {}): DraftSaveResult =>
    finish({ ok: false, operationId: op, code, steps, ...extra } as DraftSaveResult);

  if (input.actor.role !== 'owner') return fail('FORBIDDEN');
  if (typeof input.proposed !== 'string' || input.proposed.length > MAX_DRAFT_CHARS) return fail('VALIDATION_FAILED');

  // Load the authoritative row.
  let record: LibraryRecord;
  try {
    record = await repo.getLibrary(input.libraryId);
  } catch (error) {
    return fail(isAppError(error) ? error.code : 'PROVIDER_UNAVAILABLE');
  }
  const sheetAlreadyHasIt = record.value.draftContent === input.proposed;
  if (record.revision !== input.expectedSheetRevision && !sheetAlreadyHasIt) {
    return fail('STALE_READ', { conflict: { provider: 'sheet', current: record.value.draftContent, currentRevision: record.revision } });
  }

  // Step 1: Drive section.
  const read = await readSection(drive, record);
  if (!read.ok) {
    steps.push({ step: 'update Markdown section', provider: 'drive', status: 'failed', errorCode: read.code });
    steps.push({ step: 'mirror Draft Content to Sheet', provider: 'sheet', status: 'pending' });
    return fail(sheetAlreadyHasIt ? 'PARTIAL_FAILURE' : read.code, { details: { reason: read.reason } });
  }
  let driveRevision = read.meta.revision;
  let sectionHash = read.section.bodyHash;
  if (read.section.body === input.proposed) {
    steps.push({ step: 'update Markdown section', provider: 'drive', status: 'skipped_already_applied', revision: driveRevision });
  } else if (read.section.bodyHash !== input.expectedSectionHash) {
    return fail('STALE_READ', { conflict: { provider: 'drive', current: read.section.body, currentRevision: read.section.bodyHash } });
  } else {
    // Refuse text that would open a new section or leave a code fence open: it
    // would swallow the sections after it in the shared master file.
    const next = safeReplaceSectionBody(read.text, read.section, input.proposed);
    if (next === null) {
      return fail('VALIDATION_FAILED', { details: { reason: 'unsafe_markdown_structure', problems: sectionBodyProblems(input.proposed, read.section.level) } });
    }
    try {
      const meta = await drive.writeText(read.fileId, next, read.meta.revision);
      driveRevision = meta.revision;
      sectionHash = fingerprint(input.proposed);
      steps.push({ step: 'update Markdown section', provider: 'drive', status: 'done', revision: driveRevision });
    } catch (error) {
      const code = isAppError(error) ? error.code : 'PROVIDER_UNAVAILABLE';
      steps.push({ step: 'update Markdown section', provider: 'drive', status: 'failed', errorCode: code });
      steps.push({ step: 'mirror Draft Content to Sheet', provider: 'sheet', status: 'pending' });
      // If the Sheet already has the text, the two sides now disagree: that is partial.
      return fail(sheetAlreadyHasIt ? 'PARTIAL_FAILURE' : code);
    }
    // Verify our section, and only our section, changed.
    try {
      const after = await drive.readText(read.fileId);
      const check = findSection(after.text, input.libraryId);
      if (!check.ok || check.section.body !== input.proposed) {
        // The upload happened, so the step is done; what followed is unconfirmed.
        steps.push({ step: 'verify Markdown section', provider: 'drive', status: 'failed', errorCode: 'CONFLICT' });
        steps.push({ step: 'mirror Draft Content to Sheet', provider: 'sheet', status: 'pending' });
        return fail('PARTIAL_FAILURE', { details: { reason: 'section_changed_during_write' } });
      }
    } catch {
      // Unverified but written; the Sheet step still runs and the result stays truthful.
    }
  }

  // Step 2: Sheet mirror (+ approval reset when the approved text changed).
  const patch: LibraryPatch = {};
  if (!sheetAlreadyHasIt) patch.draftContent = input.proposed;
  if (!sheetAlreadyHasIt && record.value.reviewStatus.ok && record.value.reviewStatus.value === 'Approved') {
    patch.reviewStatus = SHEET_WRITE_VALUE.review.Pending;
  }
  if (Object.keys(patch).length === 0) {
    steps.push({ step: 'mirror Draft Content to Sheet', provider: 'sheet', status: 'skipped_already_applied', revision: record.revision });
    const allSkipped = steps.every((s) => s.status === 'skipped_already_applied');
    return finish({ ok: true, operationId: op, replayed: allSkipped, value: { record, sectionHash, driveRevision }, steps });
  }
  const res = await repo.updateLibrary({
    operationId: `${op}_sheet`.slice(0, 80),
    actor: input.actor,
    target: { libraryId: input.libraryId },
    expectedRevision: record.revision,
    patch,
  });
  if (!res.ok) {
    steps.push({ step: 'mirror Draft Content to Sheet', provider: 'sheet', status: 'failed', errorCode: res.code });
    const driveDone = steps.some((s) => s.provider === 'drive' && s.status === 'done');
    return fail(driveDone ? 'PARTIAL_FAILURE' : res.code);
  }
  steps.push({ step: 'mirror Draft Content to Sheet', provider: 'sheet', status: res.replayed ? 'skipped_already_applied' : 'done', revision: res.value.revision });
  return finish({ ok: true, operationId: op, replayed: false, value: { record: res.value, sectionHash, driveRevision }, steps });
}
