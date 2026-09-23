import 'server-only';
import { findTemplate, scoreTotal, type HookAlternative, type HookOutput, type HookScores } from '@/domain/hook-frameworks';
import { PLATFORM_CHAR_LIMITS, type EnglishQaOutput, type QaCategory, type QaFinding, type QaSeverity } from '@/domain/proposals';
import { glossaryTermsIn, type ZhAdaptationOutput } from '@/domain/zh-terms';
import type { EnglishQaInput } from '@/application/english-qa';
import type { HookInput } from '@/application/hooks';
import type { ZhInput } from '@/application/zh-tw';

/**
 * Deterministic stand-ins for the model (fake mode, unit and e2e tests).
 *
 * They follow the house rules closely enough that fixtures produce realistic,
 * attributable output, and their output goes through exactly the same schema,
 * normalise and validate path as a real model reply.
 */

// ------------------------------------------------------------------ English QA

export const BRITISH_SPELLING: Record<string, string> = {
  color: 'colour',
  colors: 'colours',
  organize: 'organise',
  organized: 'organised',
  organization: 'organisation',
  analyze: 'analyse',
  analyzed: 'analysed',
  center: 'centre',
  favorite: 'favourite',
  behavior: 'behaviour',
  realize: 'realise',
  prioritize: 'prioritise',
  apologize: 'apologise',
  // `program` is deliberately absent: it is correct British English for software.
};

export const BANNED_WORDS: Record<string, string | null> = {
  leverage: 'use',
  synergy: null,
  'game-changer': null,
  delve: 'look',
};

type Draft = Omit<QaFinding, 'id'>;

function matchCase(word: string, replacement: string): string {
  if (word === word.toUpperCase() && word.length > 1) return replacement.toUpperCase();
  if (word[0] === word[0]!.toUpperCase()) return replacement[0]!.toUpperCase() + replacement.slice(1);
  return replacement;
}

function push(out: Draft[], start: number, end: number, draft: string, category: QaCategory, severity: QaSeverity, replacement: string | null, explanation: string): void {
  out.push({ category, start, end, original: draft.slice(start, end), replacement, explanation, severity });
}

export function fakeEnglishQa(input: EnglishQaInput): EnglishQaOutput {
  const d = input.draft;
  const found: Draft[] = [];
  for (const m of d.matchAll(/\b[A-Za-z]+\b/g)) {
    const brit = BRITISH_SPELLING[m[0].toLowerCase()];
    if (brit) push(found, m.index, m.index + m[0].length, d, 'spelling', 'should', matchCase(m[0], brit), 'Use British spelling.');
  }
  for (const [word, replacement] of Object.entries(BANNED_WORDS)) {
    const re = new RegExp(`\\b${word.replace('-', '\\-')}\\b`, 'gi');
    for (const m of d.matchAll(re)) {
      push(found, m.index, m.index + m[0].length, d, 'banned_word', 'must', replacement === null ? null : matchCase(m[0], replacement), 'This word is on the banned list; say what you mean plainly.');
    }
  }
  for (const m of d.matchAll(/ ?\u2014 ?/g)) {
    push(found, m.index, m.index + m[0].length, d, 'punctuation', 'should', ', ', 'House style bans the em dash; use a comma, a full stop or a colon.');
  }
  for (const m of d.matchAll(/(?<=\S) {2,}(?=\S)/g)) {
    push(found, m.index, m.index + m[0].length, d, 'punctuation', 'should', ' ', 'Use a single space between words.');
  }
  for (const m of d.matchAll(/(?<=\S) +(?=[,.;:!?](\s|$))/g)) {
    push(found, m.index, m.index + m[0].length, d, 'punctuation', 'should', '', 'No space before punctuation.');
  }
  const limit = input.platform === 'LinkedIn' || input.platform === 'X' ? PLATFORM_CHAR_LIMITS[input.platform] : null;
  let platform: Draft | null = null;
  if (limit !== null && d.length > limit) {
    platform = {
      category: 'platform_fit',
      start: limit,
      end: d.length,
      original: d.slice(limit),
      replacement: null,
      explanation: `The post is longer than the ${limit.toLocaleString('en-GB')} character limit for ${input.platform}; cut the marked tail.`,
      severity: 'must',
    };
  }
  // Keep ranges disjoint: earliest first, drop anything overlapping a kept range.
  const sorted = found.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: Draft[] = [];
  for (const f of sorted) {
    if (platform && f.end > platform.start) continue;
    if (kept.length && f.start < kept[kept.length - 1]!.end) continue;
    kept.push(f);
  }
  if (platform) kept.push(platform);
  const findings = kept.map((f, i) => ({ id: `f${i + 1}`, ...f }));
  const counts = new Map<string, number>();
  for (const f of findings) counts.set(f.category, (counts.get(f.category) ?? 0) + 1);
  const summary =
    findings.length === 0
      ? 'No issues found against the house rules.'
      : `${findings.length} finding${findings.length === 1 ? '' : 's'}: ${[...counts].map(([c, n]) => `${n} ${c.replace('_', ' ')}`).join(', ')}. Fix the must items before approval.`;
  return { findings, summary };
}

// ------------------------------------------------------------------ Hooks

const STOP = new Set(['the', 'and', 'that', 'this', 'with', 'your', 'you', 'most', 'people', 'about', 'after', 'before', 'from', 'into', 'what', 'when', 'is', 'not', 'are']);

function keywords(text: string): [string, string] {
  const words = (text.toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? []).filter((w) => !STOP.has(w));
  const unique = [...new Set(words)].sort((a, b) => b.length - a.length || a.localeCompare(b));
  return [unique[0] ?? 'the offer', unique[1] ?? unique[0] ?? 'the offer'];
}

function alt(template: string, text: string, scores: HookScores, input: HookInput, k: string): HookAlternative {
  const t = findTemplate(template)!;
  return {
    text,
    framework: t.framework,
    template: t.id,
    hookType: t.framework,
    scores,
    total: scoreTotal(scores),
    ...(input.platform === 'LinkedIn'
      ? { linkedinChecks: { audience: true, roleOrKeyword: true, directRelevance: true, notes: `Speaks to job seekers; keyword: ${k}.` } }
      : {}),
  };
}

export function fakeHooks(input: HookInput): HookOutput {
  const [k1, k2] = keywords(`${input.currentHook} ${input.draft}`);
  return {
    alternatives: [
      alt('Contrarian #12', `Everyone says ${k1} comes first. It rarely does.`, { specificity: 2, tension: 2, audienceFit: 1, credibility: 1, valuePromise: 2 }, input, k1),
      alt('Curiosity #3', `The part of ${k2} nobody explains until it is too late.`, { specificity: 1, tension: 2, audienceFit: 2, credibility: 1, valuePromise: 1 }, input, k2),
      alt('How-to #1', `How to handle ${k1} in three calm steps.`, { specificity: 2, tension: 1, audienceFit: 2, credibility: 1, valuePromise: 2 }, input, k1),
    ],
  };
}

// ------------------------------------------------------------------ zh-TW

/** Synthetic phrasebook: known fixture lines adapted by hand, in Taiwan usage. */
export const ZH_PHRASEBOOK: Record<string, string> = {
  'Your first offer is a draft.': '第一份 offer 只是草稿。',
  'Treat it like one.': '把它當草稿看待。',
  'Ask for the band.': '先問薪資範圍。',
  'Then ask where you sit in it.': '再問你在範圍的哪裡。',
  'Then ask where you sit in it. (edited)': '再問你落在範圍的哪個位置。',
  'Recruiters read the first line.': '招募人員會先看第一行。',
  'Make it about the job seeker, not the salary.': '重點放在求職者身上，而不是薪資。',
  'Silence after an offer feels risky.': '拿到 offer 後保持沉默，感覺很冒險。',
  'It is usually the strongest thing you can do.': '但這通常是你最有力的一步。',
};

function adaptLine(line: string, notes: string[]): string {
  const key = line.trim();
  if (key === '') return '';
  const known = ZH_PHRASEBOOK[key];
  if (known) return known;
  const terms = glossaryTermsIn(key).map((t) => t.zh);
  notes.push('A line outside the phrasebook needs a human adaptation.');
  return `【待人工改寫】${terms.length ? terms.join('、') : '此行'}。`;
}

export function fakeZhTw(input: ZhInput): ZhAdaptationOutput {
  const notes: string[] = [];
  const hook = adaptLine(input.hook, notes) || '【待人工改寫】';
  const content = input.content
    .split('\n')
    .map((l) => adaptLine(l, notes))
    .join('\n');
  const terms = glossaryTermsIn(`${input.hook}\n${input.content}`);
  const needsHuman = notes.length > 0;
  return {
    hook,
    content,
    terminologyNotes: terms.map((t) => `${t.en} -> ${t.zh}${t.note ? ` (${t.note})` : ''}`),
    qa: {
      meaning: needsHuman ? 'check' : 'pass',
      naturalness: needsHuman ? 'check' : 'pass',
      terminology: 'pass',
      lineBreaks: 'pass',
      taiwanUsage: 'pass',
      notes: [...new Set(notes)],
    },
  };
}
