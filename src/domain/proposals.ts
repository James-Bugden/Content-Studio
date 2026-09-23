import { z } from 'zod';
import { fingerprint } from './hash';

/**
 * English QA proposals (CS-009 ENQA-01..03).
 *
 * Isomorphic and pure so the editor can apply a proposal client-side. A proposal
 * is bound to the fingerprint of the exact draft it was generated for. Applying
 * one finding changes only its range; any other change to the draft makes the
 * proposal stale and it can no longer apply (a late result never lands on newer
 * text).
 */
export const QA_CATEGORIES = [
  'spelling',
  'grammar',
  'punctuation',
  'banned_word',
  'clarity',
  'voice',
  'factual_consistency',
  'platform_fit',
] as const;
export type QaCategory = (typeof QA_CATEGORIES)[number];

export const QA_SEVERITIES = ['must', 'should', 'consider'] as const;
export type QaSeverity = (typeof QA_SEVERITIES)[number];

export const qaFindingSchema = z.object({
  id: z.string().min(1).max(40),
  category: z.enum(QA_CATEGORIES),
  /** UTF-16 index into the exact draft, inclusive. */
  start: z.number().int().min(0),
  /** UTF-16 index into the exact draft, exclusive. */
  end: z.number().int().min(0),
  original: z.string().max(30_000),
  replacement: z.string().max(30_000).nullable(),
  explanation: z.string().min(1).max(600),
  severity: z.enum(QA_SEVERITIES),
});
export type QaFinding = z.infer<typeof qaFindingSchema>;

export const englishQaOutputSchema = z.object({
  findings: z.array(qaFindingSchema).max(200),
  summary: z.string().max(2000),
});
export type EnglishQaOutput = z.infer<typeof englishQaOutputSchema>;

export type QaProposal = {
  id: string;
  /** Fingerprint of the exact draft the findings refer to. */
  draftHash: string;
  findings: QaFinding[];
  summary: string;
};

/** Semantic problems in QA output, by path only (never quoting the draft). */
export function qaProblems(value: EnglishQaOutput, draft: string): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  value.findings.forEach((f, i) => {
    if (seen.has(f.id)) problems.push(`findings.${i}.id: duplicate id`);
    seen.add(f.id);
    if (f.start >= f.end || f.end > draft.length) {
      problems.push(`findings.${i}: range out of bounds for the draft`);
      return;
    }
    if (draft.slice(f.start, f.end) !== f.original) problems.push(`findings.${i}.original: does not equal the draft text at start..end`);
  });
  const ordered = value.findings
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => f.start < f.end && f.end <= draft.length)
    .sort((a, b) => a.f.start - b.f.start || a.f.end - b.f.end);
  for (let k = 1; k < ordered.length; k += 1) {
    if (ordered[k]!.f.start < ordered[k - 1]!.f.end) problems.push(`findings.${ordered[k]!.i}: overlaps findings.${ordered[k - 1]!.i}`);
  }
  return problems;
}

/**
 * Models are unreliable at counting UTF-16 offsets. When `original` does not sit
 * at the stated range but occurs in the draft, move the range to the occurrence
 * nearest the stated start. The text must still match exactly, so this never
 * invents a finding; anything that cannot be relocated is left for validation.
 */
export function relocateFindings(value: EnglishQaOutput, draft: string): EnglishQaOutput {
  const findings = value.findings.map((f) => {
    if (f.original === '' || draft.slice(f.start, f.end) === f.original) return f;
    let best = -1;
    for (let at = draft.indexOf(f.original); at >= 0; at = draft.indexOf(f.original, at + 1)) {
      if (best < 0 || Math.abs(at - f.start) < Math.abs(best - f.start)) best = at;
    }
    return best < 0 ? f : { ...f, start: best, end: best + f.original.length };
  });
  return { ...value, findings };
}

export type ApplyFindingResult =
  | { ok: true; draft: string; draftHash: string; /** The remaining findings, shifted and re-bound to the new draft. */ proposal: QaProposal }
  | { ok: false; code: 'STALE_READ' | 'NOT_FOUND' | 'VALIDATION_FAILED'; reason: 'draft_changed' | 'range_changed' | 'unknown_finding' | 'no_replacement' };

/**
 * Apply exactly one finding (ENQA-02). Refuses when the draft is not the one the
 * proposal was made for, or the range no longer holds the original text (ENQA-03).
 */
export function applyFinding(draft: string, draftHash: string, proposal: QaProposal, findingId: string): ApplyFindingResult {
  if (fingerprint(draft) !== draftHash || draftHash !== proposal.draftHash) return { ok: false, code: 'STALE_READ', reason: 'draft_changed' };
  const finding = proposal.findings.find((f) => f.id === findingId);
  if (!finding) return { ok: false, code: 'NOT_FOUND', reason: 'unknown_finding' };
  if (draft.slice(finding.start, finding.end) !== finding.original) return { ok: false, code: 'STALE_READ', reason: 'range_changed' };
  if (finding.replacement === null) return { ok: false, code: 'VALIDATION_FAILED', reason: 'no_replacement' };
  const next = draft.slice(0, finding.start) + finding.replacement + draft.slice(finding.end);
  const delta = finding.replacement.length - (finding.end - finding.start);
  const nextHash = fingerprint(next);
  const remaining = proposal.findings
    .filter((f) => f.id !== finding.id)
    .filter((f) => f.end <= finding.start || f.start >= finding.end)
    .map((f) => (f.start >= finding.end ? { ...f, start: f.start + delta, end: f.end + delta } : f));
  return { ok: true, draft: next, draftHash: nextHash, proposal: { ...proposal, draftHash: nextHash, findings: remaining } };
}

/**
 * Hard post-length limits used by the platform-fit check. X is 25,000 (X Premium):
 * never cap X at 280.
 */
export const PLATFORM_CHAR_LIMITS: Record<'X' | 'LinkedIn' | 'Threads', number> = { X: 25_000, LinkedIn: 3_000, Threads: 500 };
