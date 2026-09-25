import { z } from 'zod';
import { extractJsonObject } from './guards/parse';
import { runGuards, type GuardReport } from './guards';
import type { EligibleFact, GenerationContext, ProviderIdea } from './types';
import { toPlatformText } from '@/replies/lib/text/platform-text';
import { PLATFORM_FORMAT_RULES } from './prompts/format';

/**
 * The two single-answer tasks: rewriting the owner's own draft (D08) and reading a
 * Chinese draft back in English (D09).
 *
 * Both used to be "send some text and trust whatever comes back". That made two
 * things possible at once. A provider answering a different question reached the
 * owner as a proposal, and a proposal reached the owner without passing any of the
 * checks a generated idea has to pass. Declaring the shape of each answer closes
 * the first; putting a rewrite through `runGuards` closes the second.
 *
 * The instructions live here rather than in the routes because the fake provider
 * has to be able to tell which question it was asked, and a shared module is the
 * only version of that which cannot drift.
 */

export type RewriteAction = 'shorter' | 'more_direct' | 'warmer' | 'add_personal_example';

export const REWRITE_ACTIONS: Readonly<Record<RewriteAction, string>> = Object.freeze({
  shorter: 'Make it shorter without losing the useful point. Do not add anything new.',
  more_direct: 'Make it more direct. Remove hedging. Do not make it blunt or rude.',
  warmer: 'Make it warmer. Do not add flattery, and do not add an opening compliment.',
  add_personal_example:
    'Add a first-person example ONLY if one of the supplied approved facts supports it, saying no more than that fact says. If none fits, return the text unchanged.',
});

/** The line a rewrite instruction carries when the platform reviews in English. */
export const MEANING_REQUIRED_LINE =
  'english_meaning is required: what the revised Chinese says, in English.';

export const rewriteOutputSchema = z.object({
  revised_text: z.string().min(1),
  english_meaning: z.string().nullable().default(null),
  /** The approved facts the revision leans on, so grounding can check the claim. */
  uses_fact_ids: z.array(z.string()).default([]),
});
export type RewriteOutput = z.infer<typeof rewriteOutputSchema>;

export const translationOutputSchema = z.object({
  english_meaning: z.string().min(1),
});
export type TranslationOutput = z.infer<typeof translationOutputSchema>;

export type TaskParseResult<T> = { ok: true; value: T } | { ok: false; detail: string };

export function assembleRewriteInstruction(
  action: RewriteAction,
  facts: EligibleFact[],
  options: { requireEnglishMeaning: boolean },
): string {
  return [
    "You revise one social reply on its author's behalf.",
    REWRITE_ACTIONS[action],
    'Return JSON only, with no prose around it, shaped exactly:',
    '{"revised_text":"...","english_meaning":null,"uses_fact_ids":[]}',
    'revised_text is plain text ready to post. Never put a link in it.',
    PLATFORM_FORMAT_RULES,
    'uses_fact_ids lists the ids of the approved facts the revision relies on. Only the',
    'text of a supplied fact may become a first-person claim, and the revision must not',
    'say more than that fact says.',
    options.requireEnglishMeaning ? MEANING_REQUIRED_LINE : 'Set english_meaning to null.',
    facts.length > 0
      ? `Approved facts you may draw on:\n${facts.map((fact) => `- ${fact.id}: ${fact.text}`).join('\n')}`
      : 'There are no approved facts, so do not add a personal story.',
  ].join('\n\n');
}

export function assembleTranslationInstruction(): string {
  return [
    'You translate a Traditional Chinese social reply into English so its author can check it.',
    'Say what the Chinese says, including its tone.',
    'Do not improve it, do not add anything, and do not return the Chinese.',
    'Return JSON only, with no prose around it, shaped exactly:',
    '{"english_meaning":"..."}',
  ].join('\n');
}

function readJsonObject(rawText: string): TaskParseResult<unknown> {
  const candidate = extractJsonObject(rawText);
  if (!candidate) return { ok: false, detail: 'No JSON object found in the response.' };
  try {
    return { ok: true, value: JSON.parse(candidate) as unknown };
  } catch {
    return { ok: false, detail: 'The response was not parseable JSON.' };
  }
}

function firstIssue(error: z.ZodError, fallbackPath: string): string {
  const issue = error.issues[0];
  // The path, never the value: the value is the owner's writing.
  return `${issue?.path.join('.') || fallbackPath}: ${issue?.message ?? 'did not match the schema'}`;
}

export function parseRewriteOutput(rawText: string): TaskParseResult<RewriteOutput> {
  const json = readJsonObject(rawText);
  if (!json.ok) return json;

  const result = rewriteOutputSchema.safeParse(json.value);
  if (!result.success) return { ok: false, detail: firstIssue(result.error, 'revised_text') };

  // Cleaned before the emptiness check, so a revision that was only formatting
  // is refused rather than offered as a blank replacement for the owner's draft.
  const value = {
    ...result.data,
    revised_text: toPlatformText(result.data.revised_text),
    english_meaning:
      result.data.english_meaning === null ? null : toPlatformText(result.data.english_meaning),
  };
  if (value.revised_text === '') {
    return { ok: false, detail: 'revised_text: the revision was empty.' };
  }
  return { ok: true, value };
}

export function parseTranslationOutput(rawText: string): TaskParseResult<TranslationOutput> {
  const json = readJsonObject(rawText);
  if (!json.ok) return json;

  const result = translationOutputSchema.safeParse(json.value);
  if (!result.success) return { ok: false, detail: firstIssue(result.error, 'english_meaning') };

  const value = { ...result.data, english_meaning: toPlatformText(result.data.english_meaning) };
  if (value.english_meaning === '') {
    return { ok: false, detail: 'english_meaning: the meaning was empty.' };
  }
  return { ok: true, value };
}

/**
 * A rewrite is judged as the thing it actually is: a reply one click away from the
 * owner's editor. `runGuards` works on the three-idea shape because that is what
 * the ideas task returns, so the single revision is adapted into that shape rather
 * than the guard signature being loosened to let a second, softer caller in.
 *
 * The revision is checked against the same eligible facts as a generated idea, and
 * not against the draft it came from. A claim the owner typed but never approved as
 * a fact is therefore withheld too. That is the deliberate side of the trade: the
 * draft itself is untouched, so the cost of being wrong here is one unused rewrite.
 */
export function asProposedIdea(output: RewriteOutput, action: RewriteAction): ProviderIdea {
  return {
    position: 0,
    angle_label: action,
    reply_text: output.revised_text,
    english_meaning: output.english_meaning,
    resource_id: null,
    cta_text: null,
    uses_fact_ids: output.uses_fact_ids,
    based_on_reply_ids: [],
  };
}

export function checkRewrite(
  output: RewriteOutput,
  action: RewriteAction,
  context: GenerationContext,
  ownerBaseline: string,
): GuardReport {
  // The baseline is the draft being revised. Checking a rewrite only against the
  // approved facts would withhold the owner's own sentence back at them the moment
  // they pressed Shorter on a reply mentioning something they never registered as
  // a fact, which is the censorship C06 rules out. What the rewrite *adds* is
  // still checked normally.
  return runGuards([asProposedIdea(output, action)], { ...context, ownerBaseline });
}

