/**
 * Weekly off-project backup: pure rules (#249). No I/O, so the naming,
 * retention and warning rules are unit-testable with plain data.
 */
export const BACKUP_FILE_PREFIX = 'content-studio-backup-';
/** Drive appProperties marker set on every file this feature creates. */
export const BACKUP_MARKER_KEY = 'contentStudioBackup';
export const BACKUP_MARKER_VALUE = 'weekly-v1';
export const BACKUP_KEEP = 8;
export const BACKUP_STALE_DAYS = 8;
export const BACKUP_MAX_BYTES = 100 * 1024 * 1024;
export const BACKUP_MANIFEST_MAX_BYTES = 2 * 1024 * 1024;
/** A run still "running" after this long is treated as dead. */
export const BACKUP_RUNNING_TIMEOUT_MS = 15 * 60_000;

export const BACKUP_DATA_NAME = /^content-studio-backup-\d{4}-\d{2}-\d{2}-\d{4}\.json\.gz$/;
export const BACKUP_MANIFEST_NAME = /^content-studio-backup-\d{4}-\d{2}-\d{2}-\d{4}\.manifest\.json$/;

const TAIPEI_OFFSET_MS = 8 * 3600_000;

/** `content-studio-backup-YYYY-MM-DD-HHmm`, in Asia/Taipei (no DST). */
export function backupStem(at: number): string {
  const t = new Date(at + TAIPEI_OFFSET_MS).toISOString();
  return `${BACKUP_FILE_PREFIX}${t.slice(0, 10)}-${t.slice(11, 13)}${t.slice(14, 16)}`;
}
export const backupDataName = (stem: string) => `${stem}.json.gz`;
export const backupManifestName = (stem: string) => `${stem}.manifest.json`;

export type BackupFileInfo = { id: string; name: string; trashed?: boolean; appProperties?: Record<string, string> | null };

/** Only a file that carries our marker AND our exact naming is ever ours. */
export function isOurBackupFile(f: BackupFileInfo): boolean {
  return f.appProperties?.[BACKUP_MARKER_KEY] === BACKUP_MARKER_VALUE && !f.trashed
    && (BACKUP_DATA_NAME.test(f.name) || BACKUP_MANIFEST_NAME.test(f.name));
}
const stemOf = (name: string) => name.replace(/\.(?:json\.gz|manifest\.json)$/, '');

/**
 * Files to delete: ours only, belonging to complete backups (data + manifest)
 * beyond the newest `keep`, plus incomplete leftovers OLDER than the newest kept
 * one. Never touches a newer incomplete backup (it may be running) or any file
 * that is not ours. Returns [] when nothing complete exists.
 */
export function selectBackupsToDelete<T extends BackupFileInfo>(files: readonly T[], keep = BACKUP_KEEP): T[] {
  const byStem = new Map<string, T[]>();
  for (const f of files) {
    if (!isOurBackupFile(f)) continue;
    const stem = stemOf(f.name);
    byStem.set(stem, [...(byStem.get(stem) ?? []), f]);
  }
  const complete = (list: T[]) => list.some(f => BACKUP_DATA_NAME.test(f.name)) && list.some(f => BACKUP_MANIFEST_NAME.test(f.name));
  const stems = [...byStem.keys()].sort().reverse();
  const completeStems = stems.filter(s => complete(byStem.get(s)!));
  if (completeStems.length === 0 || keep < 1) return [];
  const kept = new Set(completeStems.slice(0, keep));
  const oldestKept = [...kept].sort()[0]!;
  return stems.filter(s => !kept.has(s) && s < oldestKept).flatMap(s => byStem.get(s)!);
}

export type BackupRunView = {
  id: string;
  trigger: 'cron' | 'manual';
  status: 'running' | 'success' | 'failure';
  startedAt: string;
  finishedAt: string | null;
  fileName: string | null;
  sizeBytes: number | null;
  rowCounts: Record<string, number> | null;
  errorMessage: string | null;
};
export type BackupStatus = { lastRun: BackupRunView | null; lastSuccess: BackupRunView | null };
export type BackupWarning = { level: 'none' | 'failed' | 'stale' | 'never'; message: string };

/**
 * Warn when the newest run failed, or the last success is older than 8 days
 * (strictly: exactly 8 days is still fine), or no backup ever succeeded.
 */
export function backupWarning(status: BackupStatus, now: number): BackupWarning {
  const { lastRun, lastSuccess } = status;
  const dead = lastRun?.status === 'running' && now - Date.parse(lastRun.startedAt) > BACKUP_RUNNING_TIMEOUT_MS;
  if (lastRun && (lastRun.status === 'failure' || dead) && (!lastSuccess || lastRun.id !== lastSuccess.id)) {
    return { level: 'failed', message: 'The last backup run failed. Your previous backup (if any) was kept. Press Back up now to retry.' };
  }
  if (!lastSuccess?.finishedAt) return { level: 'never', message: 'No successful backup yet. Press Back up now to make the first one.' };
  const age = now - Date.parse(lastSuccess.finishedAt);
  if (age > BACKUP_STALE_DAYS * 86_400_000) {
    return { level: 'stale', message: `The last successful backup is ${Math.floor(age / 86_400_000)} days old (limit ${BACKUP_STALE_DAYS}). Press Back up now.` };
  }
  return { level: 'none', message: '' };
}

export function formatBackupSize(bytes: number | null): string {
  if (bytes === null) return 'size unknown';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Shared upload guard (real and fake Drive): returns the refusal reason, or null when the upload is acceptable. */
export function backupUploadRefusal(input: { name: string; mimeType: string; size: number; appProperties: Record<string, string> }): 'file_name' | 'mime_type' | 'size' | 'marker' | null {
  const isData = BACKUP_DATA_NAME.test(input.name), isManifest = BACKUP_MANIFEST_NAME.test(input.name);
  if (!isData && !isManifest) return 'file_name';
  if (isData !== (input.mimeType === 'application/gzip') || isManifest !== (input.mimeType === 'text/plain')) return 'mime_type';
  if (input.size === 0 || input.size > (isData ? BACKUP_MAX_BYTES : BACKUP_MANIFEST_MAX_BYTES)) return 'size';
  if (Object.keys(input.appProperties).length !== 1 || input.appProperties[BACKUP_MARKER_KEY] !== BACKUP_MARKER_VALUE) return 'marker';
  return null;
}
