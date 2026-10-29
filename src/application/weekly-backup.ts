import 'server-only';
import { createHash } from 'node:crypto';
import { AppError, isAppError } from '@/domain/errors';
import {
  BACKUP_KEEP, BACKUP_MANIFEST_MAX_BYTES, BACKUP_MARKER_KEY, BACKUP_MARKER_VALUE, BACKUP_MAX_BYTES,
  backupDataName, backupManifestName, backupStem, selectBackupsToDelete, type BackupRunView,
} from '@/domain/weekly-backup';
import { exportBackup, type BackupExport, type BackupManifest } from './backup-export';
import type { BackupDriveFile, BackupDriveStore, BackupRowSource, BackupRunStore } from './backup-ports';

/**
 * Weekly backup orchestration (#249): export, upload to the owner's private
 * Drive folder, verify, record, then (only after a verified success) prune.
 */
export type WeeklyBackupDeps = {
  source: BackupRowSource;
  drive: BackupDriveStore;
  runs: BackupRunStore;
  folderId: string;
  buildCommit: string | null;
  now?: () => number;
  /** Optional heartbeat; must never throw into the run. */
  ping?: (ok: boolean) => Promise<void>;
  keep?: number;
  historyLimit?: number;
  auditLimit?: number;
  pageSize?: number;
};

export type WeeklyBackupResult =
  | { status: 'success'; run: BackupRunView; warnings: number }
  | { status: 'failure'; errorMessage: string }
  | { status: 'busy' | 'replayed'; run: BackupRunView };

/** Error text safe to store and show: a code and reason only, never a raw provider message. */
export function safeBackupError(error: unknown): string {
  if (isAppError(error)) {
    const reason = typeof error.details?.reason === 'string' && /^[a-z0-9_ -]{1,60}$/i.test(error.details.reason) ? `: ${error.details.reason}` : '';
    return `${error.code}${reason}`.slice(0, 200);
  }
  return 'UNKNOWN: unexpected error';
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const md5 = (bytes: Uint8Array) => createHash('md5').update(bytes).digest('hex');
const mismatch = (reason: string) => new AppError('CONFLICT', { reason });

/**
 * Re-checks what Drive actually holds. Success requires: the data file's size
 * and md5 equal the local gzip (a full re-download compared by sha256 when Drive
 * reports no md5), and the manifest file re-reads byte-identical and parses.
 */
export async function verifyBackupUpload(
  drive: BackupDriveStore,
  uploaded: { data: BackupDriveFile; manifest: BackupDriveFile },
  local: { gz: Uint8Array; manifestBytes: Uint8Array },
): Promise<void> {
  const data = await drive.getBackupFile(uploaded.data.id);
  if (data.trashed || data.size !== local.gz.length) throw mismatch('verify_size');
  if (data.md5Checksum) {
    if (data.md5Checksum.toLowerCase() !== md5(local.gz)) throw mismatch('verify_checksum');
  } else if (sha256(await drive.readBackupBytes(data.id, BACKUP_MAX_BYTES)) !== sha256(local.gz)) throw mismatch('verify_checksum');
  const manifestBytes = await drive.readBackupBytes(uploaded.manifest.id, BACKUP_MANIFEST_MAX_BYTES);
  if (sha256(manifestBytes) !== sha256(local.manifestBytes)) throw mismatch('verify_manifest');
  let parsed: Partial<BackupManifest>;
  try { parsed = JSON.parse(new TextDecoder().decode(manifestBytes)) as Partial<BackupManifest>; } catch { throw mismatch('verify_manifest_parse'); }
  if (parsed.format !== 'content-studio-backup/1' || typeof parsed.tables !== 'object' || parsed.tables === null) throw mismatch('verify_manifest_shape');
}

function rowCounts(manifest: BackupManifest): Record<string, number> {
  return Object.fromEntries(Object.entries(manifest.tables).map(([k, v]) => [k, v.rows]));
}

/** Manifest file contents: the export manifest plus the checksum of the data file. */
export function manifestFile(exported: BackupExport, fileName: string): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ ...exported.manifest, file: { name: fileName, bytes: exported.gz.length, sha256: exported.sha256, md5: exported.md5 } }, null, 2));
}

export async function runWeeklyBackup(deps: WeeklyBackupDeps, trigger: 'cron' | 'manual', runId: string): Promise<WeeklyBackupResult> {
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const begin = await deps.runs.begin({ id: runId, trigger, startedAt: new Date(startedAt).toISOString(), buildCommit: deps.buildCommit });
  if (begin.kind !== 'started') return { status: begin.kind === 'busy' ? 'busy' : 'replayed', run: begin.run };

  const ping = async (ok: boolean) => { try { await deps.ping?.(ok); } catch { /* A heartbeat problem never fails a backup. */ } };
  try {
    const stem = backupStem(startedAt);
    const dataName = backupDataName(stem), manifestName = backupManifestName(stem);
    const exported = await exportBackup(deps.source, {
      now: startedAt, buildCommit: deps.buildCommit,
      ...(deps.historyLimit ? { historyLimit: deps.historyLimit } : {}), ...(deps.auditLimit ? { auditLimit: deps.auditLimit } : {}), ...(deps.pageSize ? { pageSize: deps.pageSize } : {}),
    });
    const manifestBytes = manifestFile(exported, dataName);
    const appProperties = { [BACKUP_MARKER_KEY]: BACKUP_MARKER_VALUE };
    // Data first, manifest last: a backup without its manifest is incomplete and is never counted.
    const data = await deps.drive.uploadBackupFile({ folderId: deps.folderId, name: dataName, mimeType: 'application/gzip', bytes: exported.gz, appProperties });
    const manifest = await deps.drive.uploadBackupFile({ folderId: deps.folderId, name: manifestName, mimeType: 'text/plain', bytes: manifestBytes, appProperties });
    await verifyBackupUpload(deps.drive, { data, manifest }, { gz: exported.gz, manifestBytes });

    // Verified. Only now may older backups go; a pruning problem is a warning, not a failure.
    let warnings = 0;
    try {
      const doomed = selectBackupsToDelete(await deps.drive.listBackupFiles(deps.folderId), deps.keep ?? BACKUP_KEEP);
      for (const file of doomed) {
        try { await deps.drive.trashBackupFile(file.id, deps.folderId); } catch { warnings += 1; }
      }
    } catch { warnings += 1; }

    const finishedAt = new Date(now()).toISOString();
    await deps.runs.finish(runId, { status: 'success', finishedAt, fileName: dataName, sizeBytes: exported.gz.length, rowCounts: rowCounts(exported.manifest), warnings });
    await ping(true);
    return {
      status: 'success', warnings,
      run: { id: runId, trigger, status: 'success', startedAt: new Date(startedAt).toISOString(), finishedAt, fileName: dataName, sizeBytes: exported.gz.length, rowCounts: rowCounts(exported.manifest), errorMessage: null },
    };
  } catch (error) {
    const errorMessage = safeBackupError(error);
    await deps.runs.finish(runId, { status: 'failure', finishedAt: new Date(now()).toISOString(), errorMessage }).catch(() => undefined);
    await ping(false);
    return { status: 'failure', errorMessage };
  }
}

/** GET <url> (success) or GET <url>/fail (failure), short timeout, https only, never throws. */
export async function pingHeartbeat(url: string | undefined, ok: boolean, fetchImpl: typeof fetch = fetch): Promise<void> {
  if (!url) return;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return;
    const target = ok ? url : `${url.replace(/\/+$/, '')}/fail`;
    await fetchImpl(target, { method: 'GET', cache: 'no-store', signal: AbortSignal.timeout(5000) });
  } catch { /* Best effort by design. */ }
}
