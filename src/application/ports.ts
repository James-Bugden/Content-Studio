import 'server-only';
import type { z } from 'zod';
import type { Capability } from '@/domain/capability';
import type { ErrorCode } from '@/domain/errors';
import type { LibraryPatch, SchedulePatch } from '@/domain/mapping';
import type { MutationEnvelope, MutationResult } from '@/domain/mutation';
import type { LibraryRecord, QueueSummaryRow, ScheduleRecord, WorkflowSettings } from '@/domain/records';
import type { SchemaProblem } from '@/domain/sheet-schema';
import type { Platform, TypefullyStatus } from '@/domain/enums';

/**
 * Integration ports (MASTER-SPEC section 3). UI and services depend on these
 * interfaces only, so fakes, the Google adapters and a later Supabase repository
 * (CS-020) are interchangeable without touching the UI.
 */

export type SchemaStatus = {
  ok: boolean;
  tabs: { tab: string; ok: boolean; problems: SchemaProblem[]; passthrough: string[] }[];
};

export interface ContentRepository {
  capability(): Capability;
  schema(): Promise<SchemaStatus>;
  listLibrary(): Promise<LibraryRecord[]>;
  getLibrary(libraryId: string): Promise<LibraryRecord>;
  /** Content Queue: same headers/shape as Content Library, a second writable tab of idea-stage rows. */
  listQueue(): Promise<LibraryRecord[]>;
  getQueue(libraryId: string): Promise<LibraryRecord>;
  updateQueue(m: MutationEnvelope<{ libraryId: string }, LibraryPatch>): Promise<MutationResult<LibraryRecord>>;
  /** Reads the derived Ready Queue tab. Never written. */
  listReadyQueue(): Promise<LibraryRecord[]>;
  listSchedule(): Promise<ScheduleRecord[]>;
  getSchedule(contentId: string): Promise<ScheduleRecord>;
  queueSummary(): Promise<QueueSummaryRow[]>;
  workflowSettings(): Promise<WorkflowSettings>;
  updateLibrary(m: MutationEnvelope<{ libraryId: string }, LibraryPatch>): Promise<MutationResult<LibraryRecord>>;
  updateSchedule(m: MutationEnvelope<{ contentId: string }, SchedulePatch>): Promise<MutationResult<ScheduleRecord>>;
}

export type DriveFileMeta = {
  id: string;
  mimeType: string;
  modifiedTime: string;
  /** Provider revision identifier (Drive headRevisionId or version). */
  revision: string;
  size: number;
  trashed: boolean;
};

export interface DriveGateway {
  capability(): Capability;
  getMeta(fileId: string): Promise<DriveFileMeta>;
  readText(fileId: string): Promise<{ text: string; meta: DriveFileMeta }>;
  /**
   * Replace a text file's content only if its revision still equals `expectedRevision`.
   * Drive has no server-side conditional update, so implementations re-check
   * metadata immediately before writing; the residual race window is documented.
   */
  writeText(fileId: string, text: string, expectedRevision: string): Promise<DriveFileMeta>;
  readBytes(fileId: string, maxBytes: number): Promise<{ bytes: Uint8Array; meta: DriveFileMeta }>;
  /**
   * Upload a new asset file (CS-012). Always a new file, never an overwrite, so an
   * approved revision's file is never replaced in place. Write-disabled or no asset
   * folder is CONFIG_MISSING.
   */
  createFile(input: DriveCreateInput): Promise<DriveFileMeta & { webLink: string }>;
}

export type DriveCreateInput = {
  /** Plain file name, `[A-Za-z0-9._-]`, at most 200 characters. */
  name: string;
  mimeType: 'image/svg+xml' | 'image/png';
  bytes: Uint8Array;
  folderId?: string;
};

export const DRIVE_CREATE_MAX_BYTES = 5 * 1024 * 1024;
export const DRIVE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

// ------------------------------------------------------------------ AI (CS-009)

export type AiTaskName = 'english_qa' | 'hooks' | 'zh_tw' | 'zh_qa';

/**
 * One structured AI task. The gateway sends `system` plus `render(input)`, asks for
 * JSON matching `schema`, then runs `normalise` and `validate`. Any problem gets at
 * most one repair request; a second failure is VALIDATION_FAILED (AI-01).
 */
export type AiTask<T, I = unknown> = {
  name: AiTaskName;
  promptVersion: string;
  system: string;
  render(input: I): string;
  schema: z.ZodType<T>;
  /** Deterministic, content-preserving clean-up before validation (e.g. relocating a mis-counted range). */
  normalise?(value: T, input: I): T;
  /** Semantic problems, by path only (e.g. out-of-range, duplicate). Empty means valid. */
  validate?(value: T, input: I): string[];
  maxOutputTokens: number;
};

export type AiMeta = {
  provider: 'fake' | 'anthropic';
  model: string;
  promptVersion: string;
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
  repaired: boolean;
  /** Set when the caller's signal aborted the run. */
  cancelled?: boolean;
};

export type AiResult<T> = { ok: true; value: T; meta: AiMeta } | { ok: false; code: ErrorCode; meta: AiMeta };

export interface AiGateway {
  capability(): Capability;
  run<T, I>(task: AiTask<T, I>, input: I, opts?: { signal?: AbortSignal }): Promise<AiResult<T>>;
}

// ------------------------------------------------------------ Typefully (CS-015/016)

/**
 * One Typefully draft as the app sees it (docs/implementation/typefully-api.md).
 * A Typefully draft can enable several platforms; Content Studio creates one
 * draft per Schedule row and platform, and `platforms` exposes any other enabled
 * platform so a combined draft is never silently treated as single (PUB-01).
 */
export type TypefullyPlatformView = { text: string; url?: string; publishedAt?: string };

export type TypefullyDraft = {
  id: string;
  /** The only enabled platform, or the first of X, LinkedIn, Threads when several are enabled. */
  platform: Platform;
  /** Every enabled platform among X, LinkedIn and Threads. */
  platforms: Platform[];
  /** Exact text for `platform`. Multi-post threads are joined with a blank-line-pair separator. */
  text: string;
  status: TypefullyStatus;
  scheduledAt?: string;
  updatedAt: string;
  publishedAt?: string;
  url?: string;
  /** Per enabled platform, for combined drafts. */
  perPlatform: Partial<Record<Platform, TypefullyPlatformView>>;
  /** Idempotency marker recovered from the draft notes, when present. */
  idempotencyKey?: string;
};

export type TypefullyMetricKey = 'views' | 'likes' | 'reposts' | 'replies' | 'bookmarks' | 'newFollowers';

export type TypefullyPublication = {
  status: TypefullyStatus;
  publishedAt?: string;
  url?: string;
  finalText?: string;
  /** Only provider-supported metrics; an absent key means unavailable, not zero (PUB-02). */
  metrics?: Partial<Record<TypefullyMetricKey, number>>;
};

export type TypefullyCreateInput = {
  platform: Platform;
  text: string;
  /** ISO 8601 with `+08:00`. */
  scheduleAt?: string;
  /** `plan` stores a dated but inert draft; `publish` schedules it to publish. Default `plan`. */
  timing?: 'plan' | 'publish';
  /** Derived from the operation id and Content ID, never from content text. */
  idempotencyKey: string;
};

export interface TypefullyGateway {
  capability(): Capability;
  getDraft(id: string): Promise<TypefullyDraft>;
  /** Drafts enabling `platform` with a scheduled or planned time in `[from, to]`. */
  listDrafts(q: { platform: Platform; from: string; to: string }): Promise<TypefullyDraft[]>;
  /** Recent draft carrying this idempotency marker, or null. Lookup only: the API has no idempotency key. */
  findByIdempotencyKey(key: string): Promise<TypefullyDraft | null>;
  createDraft(input: TypefullyCreateInput): Promise<TypefullyDraft>;
  /** Refuses with CONFLICT when the draft's `updatedAt` is no longer `expectedUpdatedAt`. */
  updateDraft(id: string, patch: { text: string; expectedUpdatedAt: string }): Promise<TypefullyDraft>;
  /** Status, URL, exact final text and supported metrics for `platform` (default: the draft's platform). */
  getPublication(id: string, platform?: Platform): Promise<TypefullyPublication>;
}
