import 'server-only';
import type { Capability } from '@/domain/capability';
import type { LibraryPatch, SchedulePatch } from '@/domain/mapping';
import type { MutationEnvelope, MutationResult } from '@/domain/mutation';
import type { LibraryRecord, QueueSummaryRow, ScheduleRecord, WorkflowSettings } from '@/domain/records';
import type { SchemaProblem } from '@/domain/sheet-schema';

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
}
