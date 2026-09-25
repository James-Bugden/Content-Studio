/**
 * Every bound the app enforces, in one place, with the reason it exists.
 *
 * These are defensive application limits and tuneable engineering defaults from
 * C05, C07 and C08. None of them is a claim about a social platform's own limit:
 * X in particular is not limited to 280 characters here.
 */

/**
 * The ceiling shared by the request limit and the import limit, named once so the
 * two cannot drift. An imported reply longer than a writable one would be accepted
 * by the parser and then rejected by the database.
 */
const REQUEST_LIMITS_TEXT_CEILING = 16_000;

/** C07 request bounds. Oversize input is rejected, never silently truncated. */
export const REQUEST_LIMITS = {
  bodyBytes: 128 * 1024,
  sourceTextCodePoints: REQUEST_LIMITS_TEXT_CEILING,
  parentTextCodePoints: 8_000,
  keywordCodePoints: 200,
  finalReplyCodePoints: REQUEST_LIMITS_TEXT_CEILING,
  searchPageSize: 25,
} as const;

/** C05 retrieval defaults. Tuneable with recorded evidence, not by guesswork. */
export const RETRIEVAL = {
  /** Independent candidate lists before fusion. */
  lexicalCandidates: 40,
  semanticCandidates: 40,
  /** Reciprocal rank fusion constant. */
  rrfK: 60,
  /** Shown immediately; the rest is behind a cursor. */
  initialResults: 3,
  /** Hard ceiling on history passed into a generation request. */
  maxContextSnippets: 7,
  /** A reply must clear this to be called a match at all. */
  minLexicalScore: 0.08,
} as const;

/** C06 resource qualification. */
export const RESOURCES = {
  maxQualified: 3,
  /** One attached resource per reply is the v1 default. */
  defaultAttachedPerReply: 1,
} as const;

/**
 * C08 generation budgets. Verified against the selected provider before deployment
 * and adjusted with recorded evidence rather than by silently truncating context.
 */
export const GENERATION = {
  activeRunsPerSession: 1,
  requestsPerOwnerPerHour: 60,
  inputTokenBudget: 6_000,
  outputTokenBudget: 1_800,
  attemptDeadlineMs: 25_000,
  totalRequestBudgetMs: 40_000,
  /** One bounded repair attempt, shared with the guard layer. Not one each. */
  maxRepairAttempts: 1,
  ideasPerRun: 3,
} as const;

/** C05 embedding outbox. */
export const EMBEDDING = {
  dimensions: 1536,
  maxAttempts: 5,
  leaseSeconds: 120,
  /** Exponential backoff base, in seconds. */
  backoffBaseSeconds: 15,
} as const;

/**
 * C04 import bounds. These protect the machine doing the import, not the app: an
 * archive is an untrusted file the owner downloaded from a platform, and a
 * decompression bomb is a real shape of that file.
 */
export const IMPORT_LIMITS = {
  /** A single archive this process will open at all. */
  maxArchiveBytes: 512 * 1024 * 1024,
  /** A single file read into memory for parsing. */
  maxFileBytes: 64 * 1024 * 1024,
  /** Total declared uncompressed size across every entry. */
  maxDeclaredUncompressedBytes: 1024 * 1024 * 1024,
  /** Uncompressed divided by compressed, across the whole archive. */
  maxExpansionRatio: 100,
  maxEntries: 20_000,
  /** Matches the reply_library length check, so an oversize row fails here first. */
  maxRecordTextCodePoints: REQUEST_LIMITS_TEXT_CEILING,
  /** Records per transaction. Bounded so a crash loses at most one chunk. */
  defaultChunkSize: 200,
} as const;

export const APP = {
  defaultTimezone: 'Asia/Taipei',
  defaultDailyTarget: 10,
} as const;

/** Backoff for embedding retries: 15s, 30s, 60s, 120s, 240s. */
export function embeddingBackoffSeconds(attempt: number): number {
  return EMBEDDING.backoffBaseSeconds * 2 ** Math.max(0, attempt - 1);
}

