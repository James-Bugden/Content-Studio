import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { TAIWAN_TERMS } from './terminology';
import type { Platform } from '@/replies/lib/contracts/vocabulary';

/**
 * Voice rules (issue #13).
 *
 * The owner's canonical writing rules are private. They are loaded at runtime from
 * `PRIVATE_SOURCE_ROOT` and are never committed here, and neither is their path.
 * What lives in this file is the compact public-safe default: enough for the app to
 * produce sane replies without the private material, and enough for a reader of this
 * repository to see exactly what the model is being asked to do.
 *
 * Two rules the product depends on:
 *
 *   * the product UI voice and the owner's personal social voice are different
 *     things. This module supplies the second one. A reply that sounds like the
 *     app's own interface copy is wrong;
 *   * nothing here ever rewrites the private canonical documents. Learning happens
 *     through retrieval and through private draft-to-final comparison, never through
 *     a model editing the rules it was given.
 */

const PRIVATE_VOICE_FILENAME = 'voice-rules.md';

/** The public-safe default, used when no private voice file is configured. */
const DEFAULT_RULES = `Write as an experienced recruiter replying to someone in their feed.

Be specific and useful. Say the one thing you actually know that the reader does not.
Acknowledge what the post got right before adding to it, and do not manufacture
disagreement to sound interesting.

Use British spelling. Write plainly: short sentences, ordinary words, contractions where
they are natural. Never use an em dash or a semicolon. Do not open with enthusiasm
("Great post", "Absolutely"), do not close with a compulsory question, and do not use
stock wrappers such as "it's worth noting" or "in today's competitive market".

Do not invent a personal anecdote. A first-person claim about an employer, a number, or
something you did may only come from a supplied approved fact, and it must say only what
that fact says. With no suitable fact, give practical advice with no first-person story.

Do not promise an outcome, quote a price, or describe a resource you were not given.`;

const THREADS_RULES = `Write the reply natively in Taiwan Traditional Chinese. Do not
write it in English and translate it: it must read as something written in Chinese in the
first place.

Use Taiwan vocabulary: ${TAIWAN_TERMS.candidate}, ${TAIWAN_TERMS.recruiter},
${TAIWAN_TERMS.headhunter}, ${TAIWAN_TERMS.hiringManager}, ${TAIWAN_TERMS.jobDescription},
${TAIWAN_TERMS.resumeBullet}. Never use mainland forms such as 招聘, never use simplified
characters, and do not leave English jargon such as "JD" untranslated in a Chinese sentence.

Then give an English meaning for the reply. The English is a review aid for the owner, not
a version to post. It should say what the Chinese says, including its tone, rather than
polishing it.`;

const PLATFORM_RULES: Readonly<Record<Platform, string>> = Object.freeze({
  linkedin: `LinkedIn. Conversational British English. A few sentences is usually right.
No hashtags, no engagement bait, no "thoughts?" sign-off.`,
  x: `X. Conversational British English, tighter than LinkedIn. There is no
character limit to write to here: say the useful thing and stop.`,
  threads: THREADS_RULES,
});

export interface VoiceRules {
  /** The rules text placed in the instruction. */
  text: string;
  /** Identifies exactly which rules produced a given run, for reproducibility. */
  version: string;
  /** Whether the private canonical rules were found, or the public default used. */
  source: 'private' | 'default';
}

let cached: VoiceRules | null = null;

/**
 * Loads the canonical rules, preferring the private file when it is configured and
 * present. A missing private file is a normal state, not an error: the app is usable
 * with the default rules, and pretending otherwise would block the whole product on
 * an optional input.
 */
export function loadVoiceRules(env: Readonly<Record<string, string | undefined>> = process.env): VoiceRules {
  if (cached) return cached;

  const root = env.PRIVATE_SOURCE_ROOT?.trim();
  if (root) {
    const path = join(root, PRIVATE_VOICE_FILENAME);
    if (existsSync(path)) {
      const text = readFileSync(path, 'utf8');
      cached = {
        text,
        // The hash identifies the rules without revealing them in a log or a run row.
        version: `private:${createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 12)}`,
        source: 'private',
      };
      return cached;
    }
  }

  cached = {
    text: DEFAULT_RULES,
    version: `default:${createHash('sha256').update(DEFAULT_RULES, 'utf8').digest('hex').slice(0, 12)}`,
    source: 'default',
  };
  return cached;
}

/** Test seam. Production never calls this. */
export function resetVoiceRulesCache(): void {
  cached = null;
}

export function platformRules(platform: Platform): string {
  return PLATFORM_RULES[platform];
}

