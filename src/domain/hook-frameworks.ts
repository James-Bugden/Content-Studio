import { z } from 'zod';
import { HOOK_TYPES, type HookType, type Platform } from './enums';

/**
 * Closed, synthetic hook-framework catalogue (CS-010).
 *
 * Template ids follow the live convention (`Contrarian #12`), and the Sheet cell
 * format is `<id> - <pattern>`. The patterns here are invented placeholders: the
 * real reference documents live in Drive (CS_HOOK_REFERENCE_FILE_IDS) and are
 * read at runtime as untrusted data, never committed.
 */
export type HookTemplate = { id: string; framework: HookType; pattern: string };

export const HOOK_TEMPLATES: readonly HookTemplate[] = [
  { id: 'Contrarian #12', framework: 'Contrarian', pattern: 'Everyone says X, but Y' },
  { id: 'Curiosity #3', framework: 'Curiosity', pattern: 'The part of X nobody explains' },
  { id: 'Story #7', framework: 'Story', pattern: 'The day X changed how I Y' },
  { id: 'Specific Result #5', framework: 'Specific Result', pattern: 'How one change produced a concrete result' },
  { id: 'Question #2', framework: 'Question', pattern: 'What happens when you stop X?' },
  { id: 'List #4', framework: 'List', pattern: 'N things to check before X' },
  { id: 'Warning #9', framework: 'Warning', pattern: 'Do not X until you Y' },
  { id: 'How-to #1', framework: 'How-to', pattern: 'How to X in N steps' },
  { id: 'Insider #6', framework: 'Insider', pattern: 'What recruiters notice first about X' },
];

export function findTemplate(id: string): HookTemplate | undefined {
  return HOOK_TEMPLATES.find((t) => t.id === id);
}

/** Sheet `Hook Template` cell value, matching the live format. */
export function formatHookTemplateCell(t: HookTemplate): string {
  return `${t.id} - ${t.pattern}`;
}

const score = z.number().int().min(0).max(2);

export const hookScoresSchema = z.object({
  specificity: score,
  tension: score,
  audienceFit: score,
  credibility: score,
  valuePromise: score,
});
export type HookScores = z.infer<typeof hookScoresSchema>;

export const linkedinChecksSchema = z.object({
  audience: z.boolean(),
  roleOrKeyword: z.boolean(),
  directRelevance: z.boolean(),
  notes: z.string().max(300),
});

export const hookAlternativeSchema = z.object({
  text: z.string().min(1).max(1000),
  framework: z.enum(HOOK_TYPES),
  template: z.string().min(1).max(60),
  hookType: z.enum(HOOK_TYPES),
  scores: hookScoresSchema,
  total: z.number().int().min(0).max(10),
  linkedinChecks: linkedinChecksSchema.optional(),
});
export type HookAlternative = z.infer<typeof hookAlternativeSchema>;

export const hookOutputSchema = z.object({ alternatives: z.array(hookAlternativeSchema).max(6) });
export type HookOutput = z.infer<typeof hookOutputSchema>;

export function scoreTotal(s: HookScores): number {
  return s.specificity + s.tension + s.audienceFit + s.credibility + s.valuePromise;
}

/** Normalised for distinctness checks: case, width, punctuation and spacing do not count. */
export function normaliseHook(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tooClose(a: string, b: string): boolean {
  return a === b || (a.length > 0 && b.length > 0 && (a.includes(b) || b.includes(a)));
}

/**
 * HOOK-01 / HOOK-04 checks, reported by path only. X is deliberately not capped
 * at 280 characters (X Premium); the schema bound is a sanity limit.
 */
export function hookProblems(
  value: HookOutput,
  input: { platform: Platform; currentHook: string; references?: readonly { text: string }[] },
): string[] {
  const problems: string[] = [];
  const alts = value.alternatives;
  if (alts.length !== 3) problems.push(`alternatives: expected exactly 3, got ${alts.length}`);
  const current = normaliseHook(input.currentHook);
  const refs = (input.references ?? []).map((r) => normaliseHook(r.text));
  const norm = alts.map((a) => normaliseHook(a.text));
  alts.forEach((a, i) => {
    const t = findTemplate(a.template);
    if (!t) problems.push(`alternatives.${i}.template: not in the catalogue`);
    else if (t.framework !== a.framework) problems.push(`alternatives.${i}.framework: does not match the template`);
    if (a.total !== scoreTotal(a.scores)) problems.push(`alternatives.${i}.total: must equal the sum of the five scores`);
    if (norm[i] === '') problems.push(`alternatives.${i}.text: empty`);
    if (tooClose(norm[i]!, current)) problems.push(`alternatives.${i}.text: not materially different from the current hook`);
    for (let j = 0; j < i; j += 1) {
      if (tooClose(norm[i]!, norm[j]!)) problems.push(`alternatives.${i}.text: not materially different from alternatives.${j}`);
    }
    if (norm[i]!.length >= 12 && refs.some((r) => r.includes(norm[i]!))) problems.push(`alternatives.${i}.text: copies a reference example`);
    if (input.platform === 'LinkedIn' && !a.linkedinChecks) problems.push(`alternatives.${i}.linkedinChecks: required for LinkedIn`);
  });
  return problems;
}

/** `Hook Alternatives` cell: one alternative per line as `Template | text | score`. */
export function formatHookAlternatives(alts: readonly HookAlternative[]): string {
  return alts.map((a) => `${a.template} | ${a.text.replace(/\s*\n\s*/g, ' ')} | ${a.total}`).join('\n');
}
