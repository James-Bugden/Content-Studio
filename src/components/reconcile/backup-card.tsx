import { BACKUP_KEEP, BACKUP_STALE_DAYS, backupWarning, formatBackupSize, type BackupStatus } from '@/domain/weekly-backup';
import { BackupNowButton } from './backup-now-button';

const taipei = (iso: string) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Taipei', dateStyle: 'medium', timeStyle: 'short' });

/** Fix issues page: weekly off-project backup status (#249). Pure in its inputs, so it is testable. */
export function BackupCard({ status, now, isOwner, folderConfigured = true, unavailable = false }: { status: BackupStatus | null; now: number; isOwner: boolean; folderConfigured?: boolean; unavailable?: boolean }) {
  const warning = status ? backupWarning(status, now) : { level: 'none' as const, message: '' };
  const last = status?.lastSuccess;
  return (
    <section aria-labelledby="backup-h" className="rounded-lg border border-line bg-card p-4">
      <h2 id="backup-h" className="text-lg font-semibold">Backup</h2>
      {unavailable ? <p role="alert" className="mt-2 font-medium text-danger">Backup status could not be read. Reload in a moment.</p> : null}
      {!folderConfigured ? <p role="alert" className="mt-2 font-medium text-danger">Backups are not set up: the Drive folder is not configured.</p> : null}
      {warning.level !== 'none' ? <p role="alert" className="mt-2 font-medium text-danger">{warning.message}</p> : null}
      <p className="mt-2">
        {last?.finishedAt ? <>Last backup: {taipei(last.finishedAt)} Taipei ({formatBackupSize(last.sizeBytes)})</> : 'Last backup: none yet'}
      </p>
      {status?.lastRun && status.lastRun.status === 'failure' ? <p className="text-sm text-ink-soft">Last run failed{status.lastRun.errorMessage ? `: ${status.lastRun.errorMessage}` : ''}.</p> : null}
      <p className="mt-1 text-sm text-ink-soft">A full copy of your posts, schedule and replies data is saved to your private Drive folder every Sunday. The newest {BACKUP_KEEP} are kept; a warning shows after {BACKUP_STALE_DAYS} days without one.</p>
      {isOwner && folderConfigured ? <BackupNowButton /> : null}
    </section>
  );
}
