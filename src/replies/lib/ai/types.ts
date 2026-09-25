import { z } from 'zod';
import type { Platform } from '@/replies/lib/contracts/vocabulary';

/**
 * C08. The generation boundary.
 *
 * Everything a provider is allowed to see, and everything it is allowed to return.
 * Two properties this file exists to make structural:
 *
 *   * the generator has no capabilities. No browsing, no shell, no social posting,
 *     no secret reading, no tool calls. It receives text and returns text;
 *   * the source post is *quoted data*. It is assembled into the request as a
 *     labelled block that the instructions explicitly say to treat as content,
 *     never as instructions.
 */

/** A past reply passed in as voice evidence. Only approved writing reaches here. */
export interface WritingSnippet {
  id: string;
  platform: Platform;
  text: string;
  /** Present only when the posting date is actually known. */
  posted_on: string | null;
}

/** An approved, active, current, public-safe fact. Nothing else is ever included. */
export interface EligibleFact {
  id: string;
  version: number;
  text: string;
}

/** A qualified resource the model may reference *by id only*. */
export interface EligibleResource {
  id: string;
  title: string;
  type: string;
  /** What the resource is about, from the registry. Not a sales claim. */
  description: string;
}

export interface GenerationContext {
  platform: Platform;
  /** The post or comment being replied to. Untrusted quoted data. */
  sourceText: string;
  /** The parent post, when the target is a comment. Also untrusted quoted data. */
  parentText: string | null;
  /** At most RETRIEVAL.maxContextSnippets items. */
  writing: WritingSnippet[];
  facts: EligibleFact[];
  resources: EligibleResource[];
  /** Recent confirmed replies, used only by the repetition guard. */
  recentReplies: { text: string; posted_on: string | null }[];
  /** Cited seeds from "Use this idea" on a past reply. */
  seedReplyIds: string[];
  /**
   * The owner's own text, when the model is revising rather than composing.
   *
   * A rewrite starts from words the owner wrote. A figure or a first-person claim
   * already in that text is theirs, not an invention, and C06 is explicit that
   * "user-written final text is never silently corrected by the generator". Without
   * this, pressing Shorter on a reply mentioning something the owner never
   * registered as an approved fact would withhold their own sentence back at them.
   *
   * It widens what counts as evidence; it never narrows it. A claim the rewrite
   * *introduces* is still checked against the approved facts.
   */
  ownerBaseline?: string;
}

/**
 * The structured idea a provider must return. `resource_id` is an id from the
 * supplied context; the server resolves it to a URL. A raw URL from the model is
 * rejected rather than published.
 */
export const providerIdeaSchema = z.object({
  position: z.number().int().min(0).max(2),
  angle_label: z.string().min(1).max(80),
  reply_text: z.string().min(1),
  english_meaning: z.string().nullable().default(null),
  resource_id: z.string().nullable().default(null),
  cta_text: z.string().nullable().default(null),
  uses_fact_ids: z.array(z.string()).default([]),
  based_on_reply_ids: z.array(z.string()).default([]),
});
export type ProviderIdea = z.infer<typeof providerIdeaSchema>;

export const providerOutputSchema = z.object({
  ideas: z.array(providerIdeaSchema).length(3),
});
export type ProviderOutput = z.infer<typeof providerOutputSchema>;

export interface GenerationUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number;
}

export interface GenerationAttempt {
  /** Raw text the provider returned. Never persisted and never logged (C08). */
  rawText: string;
  usage: GenerationUsage;
  model: string;
  provider: string;
}

/**
 * A provider failure the orchestrator can reason about without parsing messages.
 * `rate_limited` may carry the server's own Retry-After, which is honoured when it
 * fits inside the remaining request budget.
 */
export type ProviderFailureKind =
  | 'timeout'
  | 'rate_limited'
  | 'unavailable'
  | 'invalid_response'
  | 'not_configured';

export class ProviderError extends Error {
  readonly kind: ProviderFailureKind;
  readonly retryAfterSeconds?: number;

  constructor(kind: ProviderFailureKind, message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = 'ProviderError';
    this.kind = kind;
    if (retryAfterSeconds !== undefined) this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * Which question a provider is being asked.
 *
 * The app asks for three things, and they are not interchangeable: three ideas, one
 * rewrite of a draft, or the English of a Chinese draft. Passing this explicitly
 * means a provider answers the request it was given rather than inferring one from
 * the wording of an instruction, which is how the fake came to offer its ideas JSON
 * as a rewrite.
 */
export type GenerationTask = 'ideas' | 'rewrite' | 'translation';

/**
 * One paid provider plus a fake is the whole contract (C08). There is deliberately
 * no model-picker and no automatic failover to a second vendor: quietly sending the
 * owner's private writing somewhere they did not approve would be worse than an
 * outage, which the app already handles by keeping the manual path open.
 */
export interface ReplyGenerator {
  readonly name: string;
  readonly model: string;
  /**
   * Answers one bounded request: three ideas, one rewrite, or one English meaning.
   *
   * @param instruction assembled system instruction
   * @param userContent assembled, clearly-quoted user content
   * @param signal aborts when the attempt deadline passes
   * @param task which question is being asked; absent means the ideas task
   */
  complete(
    instruction: string,
    userContent: string,
    options: { signal: AbortSignal; maxOutputTokens: number; task?: GenerationTask },
  ): Promise<GenerationAttempt>;
}

