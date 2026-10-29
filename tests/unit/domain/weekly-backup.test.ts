import { describe, expect, it } from 'vitest';
import {
  BACKUP_MAX_BYTES, backupDataName, backupManifestName, backupStem, backupUploadRefusal, backupWarning, isOurBackupFile, selectBackupsToDelete,
  type BackupFileInfo, type BackupRunView, type BackupStatus,
} from '@/domain/weekly-backup';

const marker = { contentStudioBackup: 'weekly-v1' };
const stemAt = (day: number) => `content-studio-backup-2026-10-${String(day).padStart(2, '0')}-0300`;
let n = 0;
const ours = (stem: string, kind: 'data' | 'manifest', extra: Partial<BackupFileInfo> = {}): BackupFileInfo => ({
  id: `id${++n}`, name: kind === 'data' ? backupDataName(stem) : backupManifestName(stem), appProperties: marker, ...extra,
});
const pair = (day: number) => [ours(stemAt(day), 'data'), ours(stemAt(day), 'manifest')];

describe('names', () => {
  it('uses Taipei time with no seconds', () => {
    expect(backupStem(Date.parse('2026-11-01T19:05:59Z'))).toBe('content-studio-backup-2026-11-02-0305');
    expect(backupDataName('content-studio-backup-2026-11-02-0305')).toBe('content-studio-backup-2026-11-02-0305.json.gz');
    expect(backupManifestName('content-studio-backup-2026-11-02-0305')).toBe('content-studio-backup-2026-11-02-0305.manifest.json');
  });
});

describe('retention selection', () => {
  it('keeps the newest 8 complete backups and deletes only older ones', () => {
    const files = Array.from({ length: 10 }, (_, i) => pair(i + 1)).flat();
    const doomed = selectBackupsToDelete(files, 8);
    expect(doomed.map(f => f.name).sort()).toEqual([backupDataName(stemAt(1)), backupManifestName(stemAt(1)), backupDataName(stemAt(2)), backupManifestName(stemAt(2))].sort());
  });
  it('deletes nothing with 8 or fewer backups', () => {
    expect(selectBackupsToDelete(Array.from({ length: 8 }, (_, i) => pair(i + 1)).flat(), 8)).toEqual([]);
  });
  it('never touches files without our marker or name, or anything already trashed', () => {
    const files: BackupFileInfo[] = [
      ...Array.from({ length: 10 }, (_, i) => pair(i + 1)).flat(),
      { id: 'a', name: backupDataName(stemAt(1)), appProperties: null },
      { id: 'b', name: backupDataName('content-studio-backup-2025-01-01-0300'), appProperties: { contentStudioBackup: 'other' } },
      { id: 'c', name: 'holiday-photos.jpg', appProperties: marker },
      { id: 'd', name: 'content-studio-backup-2025-01-01-0300.json.gz.bak', appProperties: marker },
      { id: 'e', name: backupDataName('content-studio-backup-2025-02-01-0300'), appProperties: marker, trashed: true },
    ];
    const ids = new Set(selectBackupsToDelete(files, 8).map(f => f.id));
    for (const id of ['a', 'b', 'c', 'd', 'e']) expect(ids.has(id)).toBe(false);
    expect(ids.size).toBe(4);
  });
  it('counts only complete backups, leaves a newer incomplete one alone and removes an older incomplete one', () => {
    const files = [...Array.from({ length: 8 }, (_, i) => pair(i + 1)).flat(), ours(stemAt(20), 'data')];
    expect(selectBackupsToDelete(files, 8)).toEqual([]);
    const old = ours('content-studio-backup-2026-09-01-0300', 'data');
    expect(selectBackupsToDelete([...files, old], 8).map(f => f.id)).toEqual([old.id]);
  });
  it('deletes nothing when no complete backup exists', () => {
    expect(selectBackupsToDelete([ours(stemAt(1), 'data'), ours(stemAt(2), 'data')], 8)).toEqual([]);
  });
  it('recognises ours strictly', () => {
    expect(isOurBackupFile(ours(stemAt(1), 'data'))).toBe(true);
    expect(isOurBackupFile({ id: 'x', name: backupDataName(stemAt(1)), appProperties: {} })).toBe(false);
  });
});

const run = (over: Partial<BackupRunView>): BackupRunView => ({
  id: 'r1', trigger: 'cron', status: 'success', startedAt: '2026-10-20T19:00:00Z', finishedAt: '2026-10-20T19:01:00Z', fileName: 'f', sizeBytes: 10, rowCounts: {}, errorMessage: null, ...over,
});
const statusOf = (lastRun: BackupRunView | null, lastSuccess: BackupRunView | null = lastRun?.status === 'success' ? lastRun : null): BackupStatus => ({ lastRun, lastSuccess });

describe('stale or failed warning', () => {
  const success = run({});
  const at = (ms: number) => Date.parse('2026-10-20T19:01:00Z') + ms;
  const DAY = 86_400_000;
  it('is clear for a recent success', () => expect(backupWarning(statusOf(success), at(DAY)).level).toBe('none'));
  it('is still clear at exactly 8 days and warns just after', () => {
    expect(backupWarning(statusOf(success), at(8 * DAY)).level).toBe('none');
    expect(backupWarning(statusOf(success), at(8 * DAY + 1)).level).toBe('stale');
  });
  it('warns when the newest run failed even if a success is recent', () => {
    const failed = run({ id: 'r2', status: 'failure', finishedAt: '2026-10-21T19:01:00Z', errorMessage: 'CONFLICT' });
    expect(backupWarning(statusOf(failed, success), at(2 * DAY)).level).toBe('failed');
  });
  it('warns when nothing ever succeeded', () => {
    expect(backupWarning(statusOf(null, null), at(0)).level).toBe('never');
  });
  it('treats a run stuck in running for over 15 minutes as failed, but not a fresh one', () => {
    const running = run({ id: 'r3', status: 'running', startedAt: '2026-10-21T19:00:00Z', finishedAt: null });
    expect(backupWarning(statusOf(running, success), Date.parse('2026-10-21T19:10:00Z')).level).toBe('none');
    expect(backupWarning(statusOf(running, success), Date.parse('2026-10-21T19:16:00Z')).level).toBe('failed');
  });
});

describe('upload guard', () => {
  const ok = { name: backupDataName(stemAt(1)), mimeType: 'application/gzip', size: 10, appProperties: marker };
  it('accepts gzip data and a text manifest', () => {
    expect(backupUploadRefusal(ok)).toBeNull();
    expect(backupUploadRefusal({ ...ok, name: backupManifestName(stemAt(1)), mimeType: 'text/plain' })).toBeNull();
  });
  it('refuses wrong names, mimes, sizes and markers', () => {
    expect(backupUploadRefusal({ ...ok, name: 'evil.json.gz' })).toBe('file_name');
    expect(backupUploadRefusal({ ...ok, mimeType: 'image/png' })).toBe('mime_type');
    expect(backupUploadRefusal({ ...ok, name: backupManifestName(stemAt(1)) })).toBe('mime_type');
    expect(backupUploadRefusal({ ...ok, size: 0 })).toBe('size');
    expect(backupUploadRefusal({ ...ok, size: BACKUP_MAX_BYTES + 1 })).toBe('size');
    expect(backupUploadRefusal({ ...ok, appProperties: {} })).toBe('marker');
    expect(backupUploadRefusal({ ...ok, appProperties: { ...marker, extra: 'x' } })).toBe('marker');
  });
});
