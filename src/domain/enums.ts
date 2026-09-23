/**
 * The single vocabulary for Content Studio (CS-002).
 *
 * Every enum a Sheet cell, Markdown file or provider can feed into the app is
 * declared here and nowhere else. Raw values are parsed through `parseEnum`, which
 * never falls back to a default: an unrecognised value becomes an explicit
 * `unrecognised` result that the gate engine turns into a blocker (SEC-02). That is
 * what stops an untrusted cell from selecting a code path the contract does not name.
 *
 * Vocabulary changes update docs/MASTER-SPEC.md and issue #3 first.
 */

export const PLATFORMS = ['X', 'Threads', 'LinkedIn'] as const;
export type Platform = (typeof PLATFORMS)[number];

export const LANGUAGES = ['en', 'zh-TW'] as const;
export type Language = (typeof LANGUAGES)[number];

/** Canonical workflow stage, stored in Schedule `Content Stage`. Library `State` is a separate display value (e.g. `Editing`). */
export const CONTENT_STAGES = ['Idea', 'Drafting', 'EN Review', 'EN Approved', 'Translation', 'ZH Review', 'Ready'] as const;
export type ContentStage = (typeof CONTENT_STAGES)[number];

export const TYPEFULLY_STATUSES = ['Not Sent', 'Typefully Draft', 'Planned', 'Scheduled', 'Published', 'Error'] as const;
export type TypefullyStatus = (typeof TYPEFULLY_STATUSES)[number];

/** Blank is read as `Pending` so a freshly added row is reviewable, not unknown. */
export const REVIEW_STATUSES = ['Pending', 'Approved', 'Changes Requested', 'Skipped'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** Blank is `Unchecked`, which blocks: a row nobody has checked is not a pass. */
export const COPYRIGHT_QA = ['Unchecked', 'PASS', 'REWORK'] as const;
export type CopyrightQa = (typeof COPYRIGHT_QA)[number];

/** `CHECK` means a possible duplicate awaits a human decision; `DUPLICATE` is confirmed. */
export const DUPLICATE_QA = ['Unchecked', 'PASS', 'CHECK', 'DUPLICATE'] as const;
export type DuplicateQa = (typeof DUPLICATE_QA)[number];

export const IMAGE_STATUSES = ['Not Needed', 'Needs Brief', 'Brief Ready', 'Rendering', 'Needs Review', 'Approved', 'Rejected'] as const;
export type ImageStatus = (typeof IMAGE_STATUSES)[number];

export const WORKFLOW_ROLES = ['Master', 'Variant', 'Legacy'] as const;
export type WorkflowRole = (typeof WORKFLOW_ROLES)[number];

export const HOOK_TYPES = ['Contrarian', 'Curiosity', 'Story', 'Specific Result', 'Question', 'List', 'Warning', 'How-to', 'Insider'] as const;
export type HookType = (typeof HOOK_TYPES)[number];

export type EnumParse<T extends string> =
  | { ok: true; value: T }
  | { ok: false; raw: string; reason: 'unrecognised' };

function canonical(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Parse a raw cell into a closed enum. Matching is case/space-insensitive but the
 * returned value is always the canonical spelling. `blankAs` names what an empty
 * cell means; without it, blank is unrecognised.
 */
export function parseEnum<T extends string>(
  values: readonly T[],
  raw: unknown,
  options: { blankAs?: T; aliases?: Record<string, T> } = {},
): EnumParse<T> {
  const text = typeof raw === 'string' ? raw : raw === null || raw === undefined ? '' : String(raw);
  const key = canonical(text);
  if (key === '' && options.blankAs !== undefined) return { ok: true, value: options.blankAs };
  for (const value of values) if (canonical(value) === key) return { ok: true, value };
  if (options.aliases) {
    for (const [alias, value] of Object.entries(options.aliases)) if (canonical(alias) === key) return { ok: true, value };
  }
  return { ok: false, raw: text.slice(0, 80), reason: 'unrecognised' };
}

export const PLATFORM_ALIASES: Record<string, Platform> = {
  twitter: 'X',
  'x/twitter': 'X',
  linkedin: 'LinkedIn',
  threads: 'Threads',
  'threads (legacy)': 'Threads',
};
export const REVIEW_ALIASES: Record<string, ReviewStatus> = {
  'not reviewed': 'Pending',
  'needs review': 'Pending',
  'in review': 'Pending',
  'request changes': 'Changes Requested',
  rework: 'Changes Requested',
  skip: 'Skipped',
};
/** Live Sheet vocabulary: Copyright QA uses `Cleared`, Duplicate QA uses `No flag`. */
export const COPYRIGHT_ALIASES: Record<string, CopyrightQa> = { cleared: 'PASS', pass: 'PASS', ok: 'PASS' };
export const DUPLICATE_ALIASES: Record<string, DuplicateQa> = { 'no flag': 'PASS', pass: 'PASS', unique: 'PASS', duplicate: 'DUPLICATE' };

/**
 * Values the app writes back, in the live Sheet's own vocabulary, so a cell the
 * app touches looks the same as one James edited by hand.
 */
export const SHEET_WRITE_VALUE = {
  review: { Pending: 'Not Reviewed', Approved: 'Approved', 'Changes Requested': 'Changes Requested', Skipped: 'Skipped' } satisfies Record<ReviewStatus, string>,
  copyright: { Unchecked: '', PASS: 'Cleared', REWORK: 'REWORK' } satisfies Record<CopyrightQa, string>,
  duplicate: { Unchecked: '', PASS: 'No flag', CHECK: 'CHECK', DUPLICATE: 'DUPLICATE' } satisfies Record<DuplicateQa, string>,
} as const;

/** Schedule slot names as the live Sheet writes them. */
export const SLOTS = ['Main', '2nd', '3rd'] as const;
export type Slot = (typeof SLOTS)[number];

/** Sheets checkboxes arrive as TRUE/FALSE booleans or strings depending on render option. */
export function parseBoolean(raw: unknown): boolean | null {
  if (raw === true || raw === false) return raw;
  const key = canonical(typeof raw === 'string' ? raw : String(raw ?? ''));
  if (key === 'true' || key === 'yes' || key === '1') return true;
  if (key === 'false' || key === 'no' || key === '0' || key === '') return false;
  return null;
}

export function languageFor(platform: Platform): Language {
  return platform === 'Threads' ? 'zh-TW' : 'en';
}
