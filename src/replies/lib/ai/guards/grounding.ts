import type { GenerationContext, ProviderIdea } from '../types';

/**
 * Grounding (issue #14, tests FACT-01, RES-02, AI-01).
 *
 * The rule this module enforces is narrow and worth stating plainly: a valid fact id
 * does not make a sentence true. A model can cite a real fact and still write a
 * number that is not in it, promote "contributed to" into "led", or attach the claim
 * to an employer the fact never mentions. So every referenced id is checked against
 * *this request's* eligible context, and then the claim itself is checked against the
 * text of the facts it cites.
 *
 * Every finding here is a hard failure. The orchestrator gets one shared repair
 * attempt; if the result is still unsafe, the ideas are withheld and the owner keeps
 * retrieval and the manual editor, which is a worse product but an honest one.
 */

export interface GroundingFinding {
  position: number;
  kind:
    | 'unknown_resource'
    | 'unknown_fact'
    | 'unknown_seed'
    | 'raw_url'
    | 'unsupported_number'
    | 'unsupported_first_person'
    | 'overstated_responsibility'
    | 'missing_english_meaning'
    | 'cta_without_resource';
  detail: string;
}

/** Any URL or bare domain. The server owns links; the model never supplies one. */
const URL_LIKE = /(https?:\/\/\S+|\bwww\.[a-z0-9-]+\.[a-z]{2,}\S*|\b[a-z0-9-]+\.(?:com|org|net|io|ai|co|tw)\/\S*)/i;

/** First-person experience claims: the ones that need a fact behind them. */
const FIRST_PERSON_CLAIM =
  /\b(?:I|we)\s+(?:led|ran|managed|built|founded|hired|scaled|grew|launched|owned|delivered|increased|reduced|saved|placed|interviewed|shipped)\b/i;

/** Weaker involvement in a fact becoming ownership in the reply. */
const OWNERSHIP_VERBS = /\b(?:led|ran|managed|owned|founded|headed)\b/i;
const PARTICIPATION_VERBS = /\b(?:helped|supported|contributed|assisted|worked on|part of|involved in)\b/i;

/** Numbers that assert something: counts, percentages, money, multiples. */
const CLAIM_NUMBER = /(?<![\w.])(?:[$£€]\s?)?\d[\d,]*(?:\.\d+)?\s?(?:%|k\b|m\b|x\b|percent\b)?/gi;

function normaliseNumber(token: string): string {
  return token.replace(/[\s,$£€]/g, '').toLowerCase();
}

function numbersIn(text: string): Set<string> {
  const found = new Set<string>();
  for (const match of text.matchAll(CLAIM_NUMBER)) {
    const value = normaliseNumber(match[0]);
    // Single digits are usually "one thing", "3 steps" and similar rhetoric rather
    // than a claim about the owner's record. Flagging them produces noise that
    // trains a reader to ignore the guard.
    if (value.length > 1) found.add(value);
  }
  return found;
}

export function checkGrounding(
  ideas: ProviderIdea[],
  context: GenerationContext,
  options: { requireEnglishMeaning: boolean },
): GroundingFinding[] {
  const findings: GroundingFinding[] = [];

  const eligibleResources = new Set(context.resources.map((r) => r.id));
  const eligibleFacts = new Map(context.facts.map((f) => [f.id, f.text]));
  const eligibleWriting = new Set(context.writing.map((w) => w.id));

  // Numbers the model is allowed to echo: those already in the post it is replying
  // to, or in the facts it may use. Anything else is invented.
  const contextNumbers = new Set<string>([
    ...numbersIn(context.sourceText),
    ...numbersIn(context.parentText ?? ''),
    // A rewrite's baseline is the owner's own words, so anything already in it is
    // evidence rather than invention (C06).
    ...numbersIn(context.ownerBaseline ?? ''),
  ]);

  // Likewise for a first-person claim: if the owner wrote one, a revision that
  // keeps it is not making it up.
  const ownerMadeFirstPersonClaim = FIRST_PERSON_CLAIM.test(context.ownerBaseline ?? '');

  for (const idea of ideas) {
    const add = (kind: GroundingFinding['kind'], detail: string) =>
      findings.push({ position: idea.position, kind, detail });

    if (idea.resource_id !== null && !eligibleResources.has(idea.resource_id)) {
      add('unknown_resource', 'The reply references a resource that was not offered for this request.');
    }

    if (idea.cta_text !== null && idea.resource_id === null) {
      add('cta_without_resource', 'A call to action was written with no resource attached to it.');
    }

    for (const factId of idea.uses_fact_ids) {
      if (!eligibleFacts.has(factId)) {
        add('unknown_fact', 'The reply cites a fact that is not approved for this request.');
      }
    }

    for (const seedId of idea.based_on_reply_ids) {
      if (!eligibleWriting.has(seedId)) {
        add('unknown_seed', 'The reply claims to build on writing that was not supplied.');
      }
    }

    if (URL_LIKE.test(idea.reply_text)) {
      add('raw_url', 'The reply text contains a link. Links are resolved by the application.');
    }

    if (options.requireEnglishMeaning && (idea.english_meaning ?? '').trim() === '') {
      add('missing_english_meaning', 'A Chinese reply was returned with no English meaning.');
    }

    const citedText = idea.uses_fact_ids
      .map((id) => eligibleFacts.get(id) ?? '')
      .join('\n');

    const makesFirstPersonClaim = FIRST_PERSON_CLAIM.test(idea.reply_text);

    if (makesFirstPersonClaim && citedText === '' && !ownerMadeFirstPersonClaim) {
      add(
        'unsupported_first_person',
        'The reply makes a first-person claim about the owner with no approved fact behind it.',
      );
    }

    // A number is allowed when it appears in a cited fact or in the post itself.
    // Otherwise it is a figure the model produced, which is the exact failure a
    // valid fact id is most likely to be used to excuse.
    const allowedNumbers = new Set([...contextNumbers, ...numbersIn(citedText)]);
    for (const number of numbersIn(idea.reply_text)) {
      if (!allowedNumbers.has(number)) {
        add('unsupported_number', 'The reply states a figure that is not in the supplied evidence.');
        break;
      }
    }

    // Participation in the fact, ownership in the reply.
    if (
      citedText !== '' &&
      OWNERSHIP_VERBS.test(idea.reply_text) &&
      !OWNERSHIP_VERBS.test(citedText) &&
      PARTICIPATION_VERBS.test(citedText)
    ) {
      add(
        'overstated_responsibility',
        'The reply claims to have led something the supporting fact describes as taking part in.',
      );
    }
  }

  return findings;
}

