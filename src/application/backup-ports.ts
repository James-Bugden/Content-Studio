import 'server-only';
import type { BackupRunView, BackupStatus } from '@/domain/weekly-backup';

export type BackupRow = Record<string, unknown>;

/** One keyset page request. `after` holds the last row's key columns. */
export type BackupPageRequest = {
  table: string;
  select?: string;
  order: readonly string[];
  desc: boolean;
  after: BackupRow | null;
  limit: number;
};
/** Bounded reads of the database with the service role. Throws NOT_FOUND `table_missing` for an absent table. */
export interface BackupRowSource {
  page(request: BackupPageRequest): Promise<BackupRow[]>;
  count(table: string): Promise<number | null>;
}

export type BackupDriveFile = {
  id: string;
  name: string;
  size: number;
  md5Checksum: string | null;
  createdTime: string;
  trashed: boolean;
  parents: string[];
  appProperties: Record<string, string> | null;
};
export type BackupUploadInput = {
  folderId: string;
  name: string;
  mimeType: 'application/gzip' | 'text/plain';
  bytes: Uint8Array;
  appProperties: Record<string, string>;
};
/** Guarded Drive operations used only by the weekly backup. */
export interface BackupDriveStore {
  uploadBackupFile(input: BackupUploadInput): Promise<BackupDriveFile>;
  getBackupFile(id: string): Promise<BackupDriveFile>;
  listBackupFiles(folderId: string): Promise<BackupDriveFile[]>;
  readBackupBytes(id: string, maxBytes: number): Promise<Uint8Array>;
  /** Moves to Drive trash. Refuses anything without the marker, the name pattern or the folder. */
  trashBackupFile(id: string, folderId: string): Promise<void>;
}

export type BackupBegin = { kind: 'started' } | { kind: 'busy'; run: BackupRunView } | { kind: 'replay'; run: BackupRunView };
export type BackupFinish = Partial<Pick<BackupRunView, 'fileName' | 'sizeBytes' | 'rowCounts' | 'errorMessage'>> & { status: 'success' | 'failure'; finishedAt: string; warnings?: number };
export interface BackupRunStore {
  begin(run: { id: string; trigger: 'cron' | 'manual'; startedAt: string; buildCommit: string | null }): Promise<BackupBegin>;
  finish(id: string, result: BackupFinish): Promise<void>;
  status(): Promise<BackupStatus>;
}
