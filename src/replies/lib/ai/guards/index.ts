import { checkGrounding, type GroundingFinding } from './grounding';
import { checkDisclosure, type DisclosureFinding } from './disclosure';
import { checkRepetition, type RepetitionFinding } from './repetition';
import { checkTerminology, findAiTells } from '../prompts/terminology';
import { needsEnglishMeaning } from '@/replies/lib/contracts/vocabulary';
import type { GenerationContext, ProviderIdea } from '../types';

export { checkGrounding, checkDisclosure, checkRepetition };
export type { GroundingFinding, DisclosureFinding, RepetitionFinding };
export { parseProviderOutput } from './parse';

/**
 * The validation layer (issue #14).
 *
 * One pass, two outcomes. A *hard* failure means the ideas cannot be shown: an
 * unknown id, an unsupported personal claim, a leaked credential shape, a missing
 * Chinese review meaning, or three ideas that are not actually three ideas. A
 * *soft* finding is shown to the owner as a plain warning and changes nothing else.
 *
 * This layer has no retry loop of its own. #12 owns a single shared repair budget,
 * and a second loop here would silently double the cost of every bad response.
 */

export interface GuardReport {
  /** Ideas may be shown only when this is empty. */
  hardFailures: { code: string; detail: string; position?: number }[];
  /** Shown to the owner as-is. Never a fabricated percentage. */
  warnings: string[];
  /** Feedback for the single repair attempt, if one is available. */
  repairHint: string | null;
}

export function runGuards(ideas: ProviderIdea[], context: GenerationContext): GuardReport {
  const requireEnglishMeaning = needsEnglishMeaning(context.platform);

  const grounding = checkGrounding(ideas, context, { requireEnglishMeaning });
  const disclosure = checkDisclosure(ideas);
  const repetition = checkRepetition(ideas, context);

  const hardFailures = [
    ...grounding.map((f) => ({ code: f.kind, detail: f.detail, position: f.position })),
    ...disclosure.map((f) => ({ code: f.kind, detail: f.detail, position: f.position })),
    ...repetition
      .filter((f) => f.severity === 'hard')
      .map((f) => ({ code: f.kind, detail: f.detail })),
  ];

  const warnings = repetition.filter((f) => f.severity === 'soft').map((f) => f.detail);

  // Style findings never block a reply. They are worth telling the owner about
  // because they are the tells that make a reply read as machine-written, but a
  // semicolon is not a safety problem.
  for (const idea of ideas) {
    const tells = findAiTells(idea.reply_text);
    if (tells.length > 0) {
      warnings.push(`Idea ${idea.position + 1} reads as machine-written: ${tells.join(', ')}.`);
    }
    if (requireEnglishMeaning) {
      for (const finding of checkTerminology(idea.reply_text)) {
        warnings.push(`Idea ${idea.position + 1} uses ${finding.found}: ${finding.reason}`);
      }
    }
  }

  const repairHint =
    hardFailures.length === 0
      ? null
      : [
          'The previous response was rejected. Fix these and return the same JSON shape:',
          ...hardFailures.map((f) => `- ${f.detail}`),
          'Do not add a link, do not invent a figure, and do not claim experience that was',
          'not supplied as a fact.',
        ].join('\n');

  return { hardFailures, warnings, repairHint };
}

