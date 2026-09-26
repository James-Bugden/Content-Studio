import 'server-only';
import type {
  PastReply,
  Progress,
  QualifiedResource,
  ReplyIdea,
} from '@/replies/lib/contracts/api';
import type { DatePrecision, Platform, Provenance, TargetKind } from '@/replies/lib/contracts/vocabulary';

/**
 * The data layer the routes talk to.
 *
 * It exists for one reason that is worth stating plainly: the deterministic browser
 * journeys have to run in public CI, and public CI must never hold a production
 * credential. Without this seam the only ways to run those journeys would be to
 * give CI a real database or to stop running them, and both are worse.
 *
 * The interface is deliberately narrow and domain-shaped rather than a generic
 * query builder. A route can only do the things named here, which keeps the
 * owner-only boundary and the explicit owner scoping of service-role reads
 * checkable by reading one file.
 *
 * The in-memory implementation is a test double, not a second product. It is
 * selected only by `SR_TEST_MODE=e2e` and it says so in every response that could
 * be mistaken for real data.
 */

export interface SessionRow {
  id: string;
  platform: Platform;
  source_post_id: string | null;
  source_version: number;
  editor_version: number;
  draft_text: string;
  draft_hash: string;
  state: 'draft' | 'recorded' | 'discarded';
  english_meaning: string | null;
  meaning_source_hash: string | null;
}

export interface AnalyseInput {
  /**
   * Stable per press of Get reply ideas. A second press with the same key reuses
   * the session it already created rather than leaving an orphan behind, which is
   * what makes a double click harmless rather than merely cheap.
   */
  requestKey: string;
  platform: Platform;
  targetKind: TargetKind;
  sourceText: string;
  parentText: string | null;
  sourceUrl: string | null;
}

export interface AnalyseResult {
  sessionId: string;
  sourcePostId: string | null;
  sourceVersion: number;
  contextVersion: number;
  editorVersion: number;
  history: {
    state: 'ready' | 'empty' | 'error';
    items: PastReply[];
    nextCursor: string | null;
    reason: 'no_match' | 'lookup_failed' | null;
  };
  resources: {
    state: 'ready' | 'empty' | 'error';
    items: QualifiedResource[];
    reason: 'no_match' | 'empty_catalog' | 'lookup_failed' | null;
  };
}

export interface RecordReplyInput {
  operationKey: string;
  fingerprint: string;
  sessionId: string;
  editorVersion: number;
  finalText: string;
  contentHash: string;
  searchText: string;
  replyUrl: string | null;
  postedAt: string | null;
  resourceSnapshots: unknown[];
  embeddingModel: string;
}

export interface ManualReplyInput {
  operationKey: string;
  fingerprint: string;
  platform: Platform;
  finalText: string;
  contentHash: string;
  searchText: string;
  datePrecision: DatePrecision;
  postedAt: string | null;
  postedDate: string | null;
  sourceTimezone: string | null;
  sourceText: string | null;
  parentText: string | null;
  sourceUrl: string | null;
  replyUrl: string | null;
  embeddingModel: string;
}

export interface RecordResult {
  replyId: string;
  replayed: boolean;
  recordedAt: string;
}

/** Only an active, confirmed post may become a Content Queue idea. */
export interface RecordedReplyForIdea {
  platform: Platform;
  finalText: string;
}

export interface LibrarySearchInput {
  query: string;
  platforms?: Platform[];
  provenances?: Provenance[];
  includeUnknownDates: boolean;
  cursor: string | null;
  limit: number;
}

export interface GenerationRunInput {
  sessionId: string;
  sourceVersion: number;
  editorBaseVersion: number;
  requestKey: string;
  contextVersion: number;
  promptVersion: string;
  provider: string;
  model: string;
}

export interface Store {
  readonly kind: 'supabase' | 'memory';

  dailyCounts(timezone: string): Promise<Progress>;

  getSession(sessionId: string): Promise<SessionRow | null>;
  updateSessionDraft(
    sessionId: string,
    expectedEditorVersion: number,
    draftText: string,
    draftHash: string,
  ): Promise<{ editorVersion: number; meaningIsStale: boolean }>;
  setSessionMeaning(sessionId: string, meaning: string, sourceHash: string): Promise<void>;

  analyse(input: AnalyseInput): Promise<AnalyseResult>;

  /** Eligible generation context for a session, already filtered by every gate. */
  generationContext(sessionId: string, seedReplyIds: string[]): Promise<{
    platform: Platform;
    sourceText: string;
    parentText: string | null;
    writing: { id: string; platform: Platform; text: string; posted_on: string | null }[];
    facts: { id: string; version: number; text: string }[];
    resources: { id: string; title: string; type: string; description: string }[];
    recentReplies: { text: string; posted_on: string | null }[];
  }>;

  countGenerationRunsInLastHour(): Promise<number>;
  createGenerationRun(input: GenerationRunInput): Promise<string>;
  completeGenerationRun(
    runId: string,
    outcome: {
      status: string;
      inputTokens: number | null;
      outputTokens: number | null;
      durationMs: number;
      errorCode: string | null;
    },
  ): Promise<void>;
  saveSuggestions(runId: string, ideas: Omit<ReplyIdea, 'id'>[]): Promise<ReplyIdea[]>;

  recordReply(input: RecordReplyInput): Promise<RecordResult>;
  recordManualReply(input: ManualReplyInput): Promise<RecordResult>;
  getRecordedReplyForIdea(replyId: string): Promise<RecordedReplyForIdea | null>;
  setReplyWithdrawn(replyId: string, withdrawn: boolean): Promise<void>;
  correctReply(
    replyId: string,
    expectedRevision: number,
    finalText: string,
    contentHash: string,
    searchText: string,
    reason: string,
  ): Promise<{ revision: number }>;

  searchLibrary(
    input: LibrarySearchInput,
  ): Promise<{ state: 'ready' | 'empty' | 'error'; items: PastReply[]; nextCursor: string | null }>;

  /** Whether at least one approved, active, current, public-safe fact exists. */
  hasEligibleFacts(): Promise<boolean>;

  // --- Administration (SR-018) -------------------------------------------
  // Deliberately small. This is maintenance for a registry and a fact bank,
  // not a content management product: list, save, disable, and a version check
  // so a stale form cannot overwrite a newer edit.

  listResources(): Promise<AdminResource[]>;
  saveResource(input: {
    id: string | null;
    expectedVersion: number | null;
    fields: Record<string, unknown>;
  }): Promise<{ id: string; version: number }>;

  listFacts(): Promise<AdminFact[]>;
  saveFact(input: {
    id: string | null;
    expectedVersion: number | null;
    fields: Record<string, unknown>;
  }): Promise<{ id: string; version: number }>;

  getSettings(): Promise<AdminSettings>;
  saveSettings(settings: AdminSettings): Promise<AdminSettings>;
}

export interface AdminResource {
  id: string;
  version: number;
  type: 'guide' | 'tool' | 'article' | 'book';
  ownership: 'own' | 'book';
  title_en: string;
  title_zh_tw: string | null;
  description: string;
  tags: string[];
  aliases: string[];
  canonical_path: string | null;
  zh_tw_path: string | null;
  external_url: string | null;
  cta_en: string | null;
  cta_zh_tw: string | null;
  allowed_platforms: Platform[];
  access_notes: string | null;
  active: boolean;
  verified: boolean;
}

export interface AdminFact {
  id: string;
  version: number;
  fact_text: string;
  tags: string[];
  approved: boolean;
  sensitivity: 'public_safe' | 'private_context_only';
  active: boolean;
  valid_from: string | null;
  valid_to: string | null;
  /** Derived, so the screen can say *why* a fact is not usable (C06). */
  eligible: boolean;
  ineligible_reason: string | null;
}

export interface AdminSettings {
  target_linkedin: number;
  target_x: number;
  target_threads: number;
  timezone: string;
}
