import type { GenerationContext, ProviderIdea } from '../types';

/**
 * Repetition and differentiation (AI-04, D07).
 *
 * This guard is deliberately softer than grounding, because the obvious strict
 * version is wrong. The owner gives similar advice to similar posts, and that is
 * correct behaviour, not a defect. Flagging "you have said something like this
 * before" would fire on every good reply.
 *
 * So the line is drawn at *wording*, not at topic: near-verbatim reuse of a recent
 * reply, and three ideas that are the same point in different clothes. And the
 * warning never invents precision. When a past reply has no known date, the warning
 * says so rather than inventing "12 days ago".
 */

export interface RepetitionFinding {
  kind: 'near_verbatim' | 'ideas_not_distinct' | 'shared_opening';
  /** Soft findings are shown as a plain warning. Hard ones fail the run. */
  severity: 'soft' | 'hard';
  detail: string;
  positions: number[];
}

/** Word-level shingles. Chinese is handled by character bigrams instead. */
function shingles(text: string, size = 3): Set<string> {
  const normalised = text.toLowerCase().replace(/\s+/g, ' ').trim();
  const hasHan = /\p{Script=Han}/u.test(normalised);

  if (hasHan) {
    const chars = [...normalised.replace(/[\s\p{P}]/gu, '')];
    const out = new Set<string>();
    for (let i = 0; i + 1 < chars.length; i += 1) out.add(chars[i]! + chars[i + 1]!);
    return out;
  }

  const words = normalised.replace(/[^\p{L}\p{N}\s']/gu, '').split(' ').filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + size <= words.length; i += 1) {
    out.add(words.slice(i, i + size).join(' '));
  }
  return out;
}

export function overlapRatio(a: string, b: string): number {
  const left = shingles(a);
  const right = shingles(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const item of left) if (right.has(item)) shared += 1;
  return shared / Math.min(left.size, right.size);
}

function firstWords(text: string, count = 6): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim().split(' ').slice(0, count).join(' ');
}

/** Above this, two texts are the same text with edits rather than the same idea. */
const NEAR_VERBATIM = 0.6;
/** Above this, two of the three "alternatives" are not alternatives. */
const NOT_DISTINCT = 0.7;

export function checkRepetition(
  ideas: ProviderIdea[],
  context: GenerationContext,
): RepetitionFinding[] {
  const findings: RepetitionFinding[] = [];

  for (const idea of ideas) {
    for (const recent of context.recentReplies) {
      if (overlapRatio(idea.reply_text, recent.text) >= NEAR_VERBATIM) {
        findings.push({
          kind: 'near_verbatim',
          severity: 'soft',
          positions: [idea.position],
          detail: recent.posted_on
            ? `Very similar wording to a reply posted on ${recent.posted_on}.`
            : 'Very similar wording to an earlier reply with no recorded date.',
        });
        break;
      }
    }
  }

  for (let i = 0; i < ideas.length; i += 1) {
    for (let j = i + 1; j < ideas.length; j += 1) {
      const a = ideas[i]!;
      const b = ideas[j]!;
      if (overlapRatio(a.reply_text, b.reply_text) >= NOT_DISTINCT) {
        findings.push({
          kind: 'ideas_not_distinct',
          severity: 'hard',
          positions: [a.position, b.position],
          detail: 'Two of the three ideas say the same thing in different words.',
        });
      } else if (firstWords(a.reply_text) === firstWords(b.reply_text)) {
        findings.push({
          kind: 'shared_opening',
          severity: 'soft',
          positions: [a.position, b.position],
          detail: 'Two ideas open with the same words.',
        });
      }
    }
  }

  return findings;
}

