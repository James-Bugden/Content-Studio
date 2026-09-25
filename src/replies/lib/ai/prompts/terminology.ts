/**
 * Taiwan Traditional Chinese terminology checks (issue #13).
 *
 * These are checks on *generated* text only. A reply the owner wrote themselves is
 * never corrected by this module: their wording is the reference, not the error.
 *
 * The list is deliberately short. It covers the terms where mainland usage would be
 * immediately wrong to a Taiwanese reader, not every possible regional preference.
 */

export interface TerminologyFinding {
  found: string;
  prefer: string;
  reason: string;
}

interface Rule {
  pattern: RegExp;
  prefer: string;
  reason: string;
}

const RULES: readonly Rule[] = [
  {
    pattern: /招聘/g,
    prefer: '招募',
    reason: 'Mainland usage. Taiwan says 招募.',
  },
  {
    pattern: /简历/g,
    prefer: '履歷',
    reason: 'Simplified characters in a Traditional Chinese reply.',
  },
  {
    pattern: /求职者/g,
    prefer: '求職者',
    reason: 'Simplified characters in a Traditional Chinese reply.',
  },
  {
    pattern: /猎头/g,
    prefer: '獵頭',
    reason: 'Simplified characters in a Traditional Chinese reply.',
  },
  {
    pattern: /\bJD\b/g,
    prefer: '職缺說明',
    reason: 'Untranslated English jargon in audience-facing Chinese.',
  },
  {
    pattern: /\bHR\b(?=[一-鿿])/g,
    prefer: '招募人員',
    reason: 'Untranslated English jargon inside a Chinese sentence.',
  },
];

/** The approved Taiwan vocabulary, for reference in the prompt itself. */
export const TAIWAN_TERMS = Object.freeze({
  candidate: '求職者',
  recruiter: '招募人員',
  headhunter: '獵頭',
  hiringManager: '招募主管',
  jobDescription: '職缺說明',
  resumeBullet: '履歷條目',
});

export function checkTerminology(text: string): TerminologyFinding[] {
  const findings: TerminologyFinding[] = [];
  for (const rule of RULES) {
    const matches = text.match(rule.pattern);
    if (matches) {
      for (const found of new Set(matches)) {
        findings.push({ found, prefer: rule.prefer, reason: rule.reason });
      }
    }
  }
  return findings;
}

/**
 * Wrappers and punctuation that make a reply read as machine-written.
 *
 * The em dash and the semicolon are on this list because the owner does not use
 * them in social replies; a model reaches for both constantly.
 */
const AI_TELLS: readonly { pattern: RegExp; label: string }[] = [
  { pattern: /—/g, label: 'em dash' },
  { pattern: /;/g, label: 'semicolon' },
  { pattern: /^\s*(great|excellent|fantastic|absolutely)\b/i, label: 'enthusiasm opener' },
  { pattern: /\bit'?s worth noting\b/i, label: 'stock wrapper' },
  { pattern: /\bin today'?s (?:fast-paced|competitive|digital) \w+/i, label: 'stock wrapper' },
  { pattern: /\bat the end of the day\b/i, label: 'stock wrapper' },
  { pattern: /\bdelve into\b/i, label: 'stock wrapper' },
  { pattern: /\bthanks for sharing this\b/i, label: 'stock opener' },
  { pattern: /\bwhat (?:are your thoughts|do you think)\?\s*$/i, label: 'compulsory closing question' },
];

export function findAiTells(text: string): string[] {
  const labels = new Set<string>();
  for (const tell of AI_TELLS) {
    if (tell.pattern.test(text)) labels.add(tell.label);
    tell.pattern.lastIndex = 0;
  }
  return [...labels];
}

