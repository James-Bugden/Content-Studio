import { z } from 'zod';

/**
 * Synthetic Taiwan zh-TW glossary and checks (CS-011 ZHTW-02).
 *
 * The glossary pins established terminology so adaptations stay consistent
 * (e.g. job seeker is always 求職者, offer stays as `offer`). It is a small public
 * fixture; the owner's full glossary stays private.
 */
export type GlossaryTerm = { en: string; zh: string; note?: string };

export const ZH_GLOSSARY: readonly GlossaryTerm[] = [
  { en: 'job seeker', zh: '求職者' },
  { en: 'hiring manager', zh: '用人主管' },
  { en: 'recruiter', zh: '招募人員', note: 'Use 獵頭 only for agency headhunters' },
  { en: 'headhunter', zh: '獵頭' },
  { en: 'offer', zh: 'offer', note: 'Keep the English word, as Taiwan job seekers do' },
  { en: 'interview', zh: '面試' },
  { en: 'salary', zh: '薪資' },
  { en: 'resume', zh: '履歷' },
];

/** Characters that only exist in Simplified Chinese; any one of them fails the Traditional check. */
export const SIMPLIFIED_ONLY: readonly string[] = [...'这们为说时会发经过对应该关实现学习'];

export function simplifiedCharsIn(text: string): string[] {
  return [...new Set([...text].filter((c) => SIMPLIFIED_ONLY.includes(c)))];
}

export function hasCjk(text: string): boolean {
  return /\p{Script=Han}/u.test(text);
}

/** Paragraphs are separated by one or more blank lines. */
export function paragraphCount(text: string): number {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean).length;
}

function termRegex(en: string): RegExp {
  const escaped = en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
  return new RegExp(`\\b${escaped}(?:s|es)?\\b`, 'i');
}

/** Glossary terms used in the English source (longest match wins, so `job seeker` hides nothing). */
export function glossaryTermsIn(source: string): GlossaryTerm[] {
  return ZH_GLOSSARY.filter((t) => termRegex(t.en).test(source));
}

/** English terms whose pinned zh-TW rendering is missing from the adaptation. */
export function missingTerms(source: string, adaptation: string): string[] {
  return glossaryTermsIn(source)
    .filter((t) => !adaptation.toLowerCase().includes(t.zh.toLowerCase()))
    .filter((t) => !(t.en === 'recruiter' && adaptation.includes('獵頭')))
    .map((t) => t.en);
}

export const ZH_QA_LEVELS = ['pass', 'check'] as const;

export const zhAdaptationOutputSchema = z.object({
  hook: z.string().min(1).max(2000),
  content: z.string().min(1).max(30_000),
  terminologyNotes: z.array(z.string().max(300)).max(30),
  qa: z.object({
    meaning: z.enum(ZH_QA_LEVELS),
    naturalness: z.enum(ZH_QA_LEVELS),
    terminology: z.enum(ZH_QA_LEVELS),
    lineBreaks: z.enum(ZH_QA_LEVELS),
    taiwanUsage: z.enum(ZH_QA_LEVELS),
    notes: z.array(z.string().max(300)).max(30),
  }),
});
export type ZhAdaptationOutput = z.infer<typeof zhAdaptationOutputSchema>;

/** ZHTW-02 checks, by path only. */
export function zhProblems(value: ZhAdaptationOutput, source: { hook: string; content: string }): string[] {
  const problems: string[] = [];
  for (const key of ['hook', 'content'] as const) {
    if (simplifiedCharsIn(value[key]).length > 0) problems.push(`${key}: contains Simplified-only characters; use Traditional Chinese`);
    if (!hasCjk(value[key])) problems.push(`${key}: is not Chinese`);
  }
  const want = paragraphCount(source.content);
  const got = paragraphCount(value.content);
  if (Math.abs(want - got) > 1) problems.push(`content: has ${got} paragraphs, source has ${want}`);
  for (const term of missingTerms(`${source.hook}\n${source.content}`, `${value.hook}\n${value.content}`)) {
    problems.push(`content: glossary term "${term}" is not rendered as pinned`);
  }
  return problems;
}
