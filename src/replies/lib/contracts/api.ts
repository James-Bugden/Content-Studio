import { z } from 'zod';
import {
  datePrecisionSchema,
  factSensitivitySchema,
  platformSchema,
  provenanceSchema,
  publicationEvidenceSchema,
  resourceOwnershipSchema,
  resourceTypeSchema,
  sectionStateSchema,
  targetKindSchema,
} from './vocabulary';
import { REQUEST_LIMITS } from './limits';

/**
 * C07. The request and response shape of every endpoint, shared by the routes,
 * the client and the tests so that there is exactly one definition of each.
 *
 * Two shapes recur and are worth naming:
 *
 *   * a *section state*, meaning loading, ready, empty or error, because "no matching
 *     resource" and "the lookup failed" are different answers and the UI must be
 *     able to tell them apart (D12);
 *   * an *expected version* on every mutation, because a late response must not
 *     be able to overwrite newer text (C07).
 */

const uuid = z.string().uuid();
const codePoints = (max: number) =>
  z.string().refine((s) => [...s].length <= max, { message: `must be at most ${max} characters` });

export const requestKeySchema = z.string().min(1).max(128);

// ---------------------------------------------------------------------------
// Shared result shapes
// ---------------------------------------------------------------------------

export const pastReplySchema = z.object({
  id: uuid,
  platform: platformSchema,
  excerpt: z.string(),
  full_text: z.string(),
  provenance: provenanceSchema,
  publication_evidence: publicationEvidenceSchema,
  posted_at: z.string().nullable(),
  posted_date: z.string().nullable(),
  date_precision: datePrecisionSchema,
});
export type PastReply = z.infer<typeof pastReplySchema>;

export const qualifiedResourceSchema = z.object({
  id: uuid,
  version: z.number().int().positive(),
  type: resourceTypeSchema,
  ownership: resourceOwnershipSchema,
  title: z.string(),
  /** Present only when a verified canonical URL exists. A book may have none. */
  url: z.string().url().nullable(),
  /** Which locale the resolved link actually points at. */
  locale: z.enum(['en', 'zh-TW']),
  /** True when the Chinese page does not exist and the English one is offered. */
  english_fallback: z.boolean(),
  /** One sentence naming the actual connection. Never an invented claim. */
  why_it_fits: z.string(),
  /** Verified access metadata only. Absent means unknown, never "free". */
  access_notes: z.string().nullable(),
  cta_text: z.string(),
});
export type QualifiedResource = z.infer<typeof qualifiedResourceSchema>;

export const sectionSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    state: sectionStateSchema,
    items: z.array(item),
    next_cursor: z.string().nullable().optional(),
    /** Distinguishes an empty registry from a successful search with no match. */
    reason: z.enum(['no_match', 'empty_catalog', 'lookup_failed']).nullable().optional(),
  });

// ---------------------------------------------------------------------------
// POST /api/replies/analyse
// ---------------------------------------------------------------------------

export const analyseRequestSchema = z
  .object({
    request_key: requestKeySchema,
    platform: platformSchema,
    target_kind: targetKindSchema,
    source_text: codePoints(REQUEST_LIMITS.sourceTextCodePoints),
    parent_text: codePoints(REQUEST_LIMITS.parentTextCodePoints).nullish(),
    source_url: z.string().url().nullish(),
  })
  .superRefine((value, ctx) => {
    const trimmed = value.source_text.trim();
    if (trimmed === '') {
      ctx.addIssue({
        code: 'custom',
        path: ['source_text'],
        message: 'Paste the post or comment first.',
      });
    }
    if (value.target_kind === 'keyword' && [...value.source_text].length > REQUEST_LIMITS.keywordCodePoints) {
      ctx.addIssue({
        code: 'custom',
        path: ['source_text'],
        message: `A keyword must be at most ${REQUEST_LIMITS.keywordCodePoints} characters.`,
      });
    }
  });
export type AnalyseRequest = z.infer<typeof analyseRequestSchema>;

export const analyseResponseSchema = z.object({
  session_id: uuid,
  source_post_id: uuid.nullable(),
  source_version: z.number().int().positive(),
  context_version: z.number().int().positive(),
  editor_version: z.number().int().nonnegative(),
  /** Retrieval renders before generation is even requested (D04). */
  history: sectionSchema(pastReplySchema),
  resources: sectionSchema(qualifiedResourceSchema),
  /** Keyword mode is retrieval only and never asks for generation. */
  generation_expected: z.boolean(),
});
export type AnalyseResponse = z.infer<typeof analyseResponseSchema>;

// ---------------------------------------------------------------------------
// POST /api/replies/generate
// ---------------------------------------------------------------------------

export const replyIdeaSchema = z.object({
  id: uuid,
  position: z.number().int().min(0).max(2),
  /** Describes the actual difference. Not one of three fixed modes (D07). */
  angle_label: z.string().min(1).max(80),
  reply_text: z.string().min(1),
  english_meaning: z.string().nullable(),
  resource_id: uuid.nullable(),
  cta_text: z.string().nullable(),
  uses_fact_ids: z.array(uuid),
  based_on_reply_ids: z.array(uuid),
});
export type ReplyIdea = z.infer<typeof replyIdeaSchema>;

export const generateRequestSchema = z.object({
  session_id: uuid,
  source_version: z.number().int().positive(),
  context_version: z.number().int().positive(),
  request_key: requestKeySchema,
  /** A cited seed from "Use this idea" on a past reply (D05). */
  seed_reply_ids: z.array(uuid).max(3).optional(),
});
export type GenerateRequest = z.infer<typeof generateRequestSchema>;

export const generateResponseSchema = z.object({
  generation_run_id: uuid,
  ideas: z.array(replyIdeaSchema).length(3),
  suggested_index: z.number().int().min(0).max(2),
  allowed_refinements: z.array(z.enum(['shorter', 'more_direct', 'warmer', 'add_personal_example'])),
  /** Present when the guards varied wording rather than failing (AI-04). */
  repetition_warning: z.string().nullable(),
});
export type GenerateResponse = z.infer<typeof generateResponseSchema>;

// ---------------------------------------------------------------------------
// PATCH /api/replies/session
// ---------------------------------------------------------------------------

export const sessionPatchRequestSchema = z.object({
  session_id: uuid,
  expected_editor_version: z.number().int().nonnegative(),
  draft_text: codePoints(REQUEST_LIMITS.finalReplyCodePoints),
});
export type SessionPatchRequest = z.infer<typeof sessionPatchRequestSchema>;

export const sessionPatchResponseSchema = z.object({
  session_id: uuid,
  editor_version: z.number().int().nonnegative(),
  draft_hash: z.string(),
  /** True when the English meaning no longer matches the Chinese text (D09). */
  meaning_is_stale: z.boolean(),
});
export type SessionPatchResponse = z.infer<typeof sessionPatchResponseSchema>;

// ---------------------------------------------------------------------------
// POST /api/replies/refine
// ---------------------------------------------------------------------------

export const refineRequestSchema = z.object({
  session_id: uuid,
  expected_editor_version: z.number().int().nonnegative(),
  action: z.enum(['shorter', 'more_direct', 'warmer', 'add_personal_example']),
  fact_id: uuid.nullish(),
  resource_id: uuid.nullish(),
  request_key: requestKeySchema,
});
export type RefineRequest = z.infer<typeof refineRequestSchema>;

export const refineResponseSchema = z.object({
  /** A proposal. The editor is never updated by this call (D08). */
  proposed_text: z.string(),
  base_editor_version: z.number().int().nonnegative(),
  english_meaning: z.string().nullable(),
});
export type RefineResponse = z.infer<typeof refineResponseSchema>;

// ---------------------------------------------------------------------------
// POST /api/replies/meaning
// ---------------------------------------------------------------------------

export const meaningRequestSchema = z
  .object({
    session_id: uuid.nullish(),
    suggestion_id: uuid.nullish(),
    text_hash: z.string().min(1),
    request_key: requestKeySchema,
  })
  .refine((v) => Boolean(v.session_id) !== Boolean(v.suggestion_id), {
    message: 'Provide exactly one of session_id or suggestion_id.',
  });
export type MeaningRequest = z.infer<typeof meaningRequestSchema>;

export const meaningResponseSchema = z.object({
  english_meaning: z.string(),
  /** The exact Chinese text this meaning describes. Stale if it no longer matches. */
  source_hash: z.string(),
});
export type MeaningResponse = z.infer<typeof meaningResponseSchema>;

// ---------------------------------------------------------------------------
// POST /api/replies/mark-posted
// ---------------------------------------------------------------------------

export const markPostedRequestSchema = z.object({
  session_id: uuid,
  editor_version: z.number().int().nonnegative(),
  final_text: codePoints(REQUEST_LIMITS.finalReplyCodePoints),
  reply_url: z.string().url().nullish(),
  posted_at: z.string().datetime().nullish(),
  resource_snapshots: z
    .array(
      z.object({
        resource_id: uuid,
        version: z.number().int().positive(),
        url: z.string().nullable(),
        inserted_text: z.string(),
      }),
    )
    .default([]),
});
export type MarkPostedRequest = z.infer<typeof markPostedRequestSchema>;

export const progressSchema = z.object({
  local_day: z.string(),
  timezone: z.string(),
  counts: z.object({ linkedin: z.number().int(), x: z.number().int(), threads: z.number().int() }),
  targets: z.object({ linkedin: z.number().int(), x: z.number().int(), threads: z.number().int() }),
});
export type Progress = z.infer<typeof progressSchema>;

export const markPostedResponseSchema = z.object({
  reply_id: uuid,
  /** True when this request replayed an already-committed save (C09). */
  replayed: z.boolean(),
  recorded_at: z.string(),
  progress: progressSchema,
  embedding_status: z.enum(['queued', 'done', 'unavailable']),
});
export type MarkPostedResponse = z.infer<typeof markPostedResponseSchema>;

// ---------------------------------------------------------------------------
// POST /api/replies/manual
// ---------------------------------------------------------------------------

export const manualReplyRequestSchema = z
  .object({
    platform: platformSchema,
    final_text: codePoints(REQUEST_LIMITS.finalReplyCodePoints),
    date_precision: datePrecisionSchema,
    posted_at: z.string().datetime().nullish(),
    posted_date: z.string().date().nullish(),
    source_timezone: z.string().nullish(),
    source_text: codePoints(REQUEST_LIMITS.sourceTextCodePoints).nullish(),
    parent_text: codePoints(REQUEST_LIMITS.parentTextCodePoints).nullish(),
    source_url: z.string().url().nullish(),
    reply_url: z.string().url().nullish(),
  })
  .superRefine((value, ctx) => {
    // The date columns and the precision cannot disagree. The database enforces
    // this too; catching it here produces a message a person can act on.
    if (value.date_precision === 'timestamp' && !value.posted_at) {
      ctx.addIssue({ code: 'custom', path: ['posted_at'], message: 'Add the time it was posted.' });
    }
    if (value.date_precision === 'date_only' && !value.posted_date) {
      ctx.addIssue({ code: 'custom', path: ['posted_date'], message: 'Add the date it was posted.' });
    }
    if (value.date_precision === 'unknown' && (value.posted_at || value.posted_date)) {
      ctx.addIssue({
        code: 'custom',
        path: ['date_precision'],
        message: 'An unknown date cannot carry a date.',
      });
    }
  });
export type ManualReplyRequest = z.infer<typeof manualReplyRequestSchema>;

// ---------------------------------------------------------------------------
// POST /api/replies/library/search
// ---------------------------------------------------------------------------

export const librarySearchRequestSchema = z.object({
  /** Search text goes in the body, never in a URL (SEC-05). */
  query: z.string().max(500),
  platforms: z.array(platformSchema).optional(),
  provenances: z.array(provenanceSchema).optional(),
  include_unknown_dates: z.boolean().default(true),
  cursor: z.string().nullish(),
  limit: z.number().int().min(1).max(REQUEST_LIMITS.searchPageSize).default(10),
});
export type LibrarySearchRequest = z.infer<typeof librarySearchRequestSchema>;

export const librarySearchResponseSchema = z.object({
  state: sectionStateSchema,
  items: z.array(pastReplySchema),
  next_cursor: z.string().nullable(),
});
export type LibrarySearchResponse = z.infer<typeof librarySearchResponseSchema>;

// ---------------------------------------------------------------------------
// PATCH /api/replies/library/:id
// ---------------------------------------------------------------------------

export const libraryPatchRequestSchema = z.union([
  z.object({
    action: z.literal('correct'),
    expected_revision: z.number().int().nonnegative(),
    final_text: codePoints(REQUEST_LIMITS.finalReplyCodePoints),
    reason: z.string().max(500).default(''),
  }),
  z.object({
    action: z.literal('withdraw'),
    withdrawn: z.boolean(),
  }),
]);
export type LibraryPatchRequest = z.infer<typeof libraryPatchRequestSchema>;

// ---------------------------------------------------------------------------
// Resources and facts administration
// ---------------------------------------------------------------------------

export const resourceFieldsSchema = z.object({
    type: resourceTypeSchema,
    ownership: resourceOwnershipSchema,
    title_en: z.string().min(1).max(300),
    title_zh_tw: z.string().max(300).nullish(),
    description: z.string().max(2000).default(''),
    aliases: z.array(z.string().max(120)).max(30).default([]),
    tags: z.array(z.string().max(60)).max(30).default([]),
    canonical_path: z.string().max(500).nullish(),
    zh_tw_path: z.string().max(500).nullish(),
    external_url: z.string().url().nullish(),
    cta_en: z.string().max(300).nullish(),
    cta_zh_tw: z.string().max(300).nullish(),
    allowed_platforms: z.array(platformSchema).min(1).default(['linkedin', 'x', 'threads']),
    access_notes: z.string().max(500).nullish(),
  active: z.boolean().default(true),
});

export const resourceInputSchema = resourceFieldsSchema
  .superRefine((value, ctx) => {
    if (value.ownership === 'own' && !value.canonical_path) {
      ctx.addIssue({
        code: 'custom',
        path: ['canonical_path'],
        message: 'An owned resource needs its path.',
      });
    }
    if (value.ownership === 'own' && value.external_url) {
      ctx.addIssue({
        code: 'custom',
        path: ['external_url'],
        message: 'An owned resource uses a path, not an absolute URL.',
      });
    }
    if (value.ownership === 'book' && (value.canonical_path || value.zh_tw_path)) {
      ctx.addIssue({
        code: 'custom',
        path: ['canonical_path'],
        message: 'A book is not hosted on your own site.',
      });
    }
  });
export type ResourceInput = z.infer<typeof resourceInputSchema>;

/**
 * Partial updates strip the defaults deliberately.
 *
 * `schema.partial()` keeps each field's `.default()`, so a payload that omits a
 * key parses into that key's default rather than into "leave it alone". Applied to
 * an update, that silently resets every field the caller did not mention: a change
 * to one flag would quietly reset a resource's allowed platforms. Verified against
 * zod 4.6.5. The update schemas therefore describe optional fields with no defaults
 * at all, so an absent key stays absent.
 */
const withoutDefaults = <T extends z.ZodRawShape>(shape: T) => z.object(shape).partial();

export const resourceUpdateSchema = z.object({
  expected_version: z.number().int().positive(),
  changes: withoutDefaults({
    type: resourceTypeSchema,
    ownership: resourceOwnershipSchema,
    title_en: z.string().min(1).max(300),
    title_zh_tw: z.string().max(300).nullable(),
    description: z.string().max(2000),
    aliases: z.array(z.string().max(120)).max(30),
    tags: z.array(z.string().max(60)).max(30),
    canonical_path: z.string().max(500).nullable(),
    zh_tw_path: z.string().max(500).nullable(),
    external_url: z.string().url().nullable(),
    cta_en: z.string().max(300).nullable(),
    cta_zh_tw: z.string().max(300).nullable(),
    allowed_platforms: z.array(platformSchema).min(1),
    access_notes: z.string().max(500).nullable(),
    active: z.boolean(),
  }),
});

export const factInputSchema = z.object({
  fact_text: z.string().min(1).max(2000),
  tags: z.array(z.string().max(60)).max(30).default([]),
  /** Approval is a deliberate act. Importing an anecdote never sets it (C06). */
  approved: z.boolean().default(false),
  sensitivity: factSensitivitySchema.default('private_context_only'),
  active: z.boolean().default(true),
  valid_from: z.string().date().nullish(),
  valid_to: z.string().date().nullish(),
});
export type FactInput = z.infer<typeof factInputSchema>;

export const factUpdateSchema = z.object({
  expected_version: z.number().int().positive(),
  changes: withoutDefaults({
    fact_text: z.string().min(1).max(2000),
    tags: z.array(z.string().max(60)).max(30),
    approved: z.boolean(),
    sensitivity: factSensitivitySchema,
    active: z.boolean(),
    valid_from: z.string().date().nullable(),
    valid_to: z.string().date().nullable(),
  }),
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const settingsSchema = z.object({
  target_linkedin: z.number().int().min(0).max(100),
  target_x: z.number().int().min(0).max(100),
  target_threads: z.number().int().min(0).max(100),
  timezone: z.string().min(1).max(64),
});
export type Settings = z.infer<typeof settingsSchema>;

