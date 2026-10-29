import 'server-only';
import { createHash } from 'node:crypto';
import { AppError } from '@/domain/errors';
import { backupUploadRefusal, isOurBackupFile } from '@/domain/weekly-backup';
import type { BackupDriveFile, BackupDriveStore, BackupUploadInput } from '@/application/backup-ports';

/** In-memory Drive for the weekly backup: same guards as the real adapter, plus failure injection. */
export class FakeBackupDrive implements BackupDriveStore {
  readonly files = new Map<string, BackupDriveFile & { bytes: Uint8Array }>();
  readonly trashedIds: string[] = [];
  private seq = 0;
  /** Throws on the Nth upload (1-based) from now. */
  failUploadAt: number | null = null;
  /** Reports a wrong md5 for every data file (a corrupted upload). */
  corruptMd5 = false;
  failTrash = false;
  failList = false;
  /** Folder ids this fake treats as valid. */
  constructor(private readonly folders: readonly string[] = ['SYNTH_backup_folder']) {}

  /** Seed a pre-existing file (ours or someone else's). */
  seed(name: string, opts: { marked?: boolean; folderId?: string; createdTime?: string; bytes?: Uint8Array } = {}): BackupDriveFile {
    const bytes = opts.bytes ?? new Uint8Array([1, 2, 3]);
    const id = `SYNTH_seed_${++this.seq}_0000`;
    const file = { id, name, size: bytes.length, md5Checksum: createHash('md5').update(bytes).digest('hex'), createdTime: opts.createdTime ?? '2026-01-01T00:00:00Z', trashed: false,
      parents: [opts.folderId ?? this.folders[0]!], appProperties: opts.marked === false ? null : { contentStudioBackup: 'weekly-v1' }, bytes };
    this.files.set(id, file);
    return file;
  }

  async uploadBackupFile(input: BackupUploadInput): Promise<BackupDriveFile> {
    if (!this.folders.includes(input.folderId)) throw new AppError('FORBIDDEN', { provider: 'drive', reason: 'backup_folder' });
    const refusal = backupUploadRefusal({ name: input.name, mimeType: input.mimeType, size: input.bytes.length, appProperties: input.appProperties });
    if (refusal) throw new AppError('VALIDATION_FAILED', { provider: 'drive', reason: refusal });
    if (this.failUploadAt !== null && --this.failUploadAt <= 0) { this.failUploadAt = null; throw new AppError('PROVIDER_UNAVAILABLE', { provider: 'drive', reason: 'injected' }); }
    const bytes = input.bytes.slice();
    const md5 = createHash('md5').update(bytes).digest('hex');
    const id = `SYNTH_backup_${++this.seq}_0000`;
    const file = { id, name: input.name, size: bytes.length, md5Checksum: this.corruptMd5 && input.mimeType === 'application/gzip' ? 'f'.repeat(32) : md5,
      createdTime: new Date(Date.UTC(2026, 9, 1) + this.seq * 1000).toISOString(), trashed: false, parents: [input.folderId], appProperties: { ...input.appProperties }, bytes };
    this.files.set(id, file);
    return strip(file);
  }

  async getBackupFile(id: string): Promise<BackupDriveFile> {
    const f = this.files.get(id);
    if (!f) throw new AppError('NOT_FOUND', { provider: 'drive' });
    return strip(f);
  }

  async listBackupFiles(folderId: string): Promise<BackupDriveFile[]> {
    if (this.failList) throw new AppError('PROVIDER_UNAVAILABLE', { provider: 'drive', reason: 'injected' });
    return [...this.files.values()].filter(f => f.parents.includes(folderId) && !f.trashed && isOurBackupFile(f)).map(strip);
  }

  async readBackupBytes(id: string, maxBytes: number): Promise<Uint8Array> {
    const f = this.files.get(id);
    if (!f || f.trashed || !isOurBackupFile(f)) throw new AppError('FORBIDDEN', { provider: 'drive', reason: 'not_a_backup' });
    if (f.size > maxBytes) throw new AppError('VALIDATION_FAILED', { provider: 'drive', reason: 'too_large' });
    return f.bytes.slice();
  }

  async trashBackupFile(id: string, folderId: string): Promise<void> {
    if (this.failTrash) throw new AppError('PROVIDER_UNAVAILABLE', { provider: 'drive', reason: 'injected' });
    const f = this.files.get(id);
    if (!f || !isOurBackupFile(f) || !f.parents.includes(folderId)) throw new AppError('FORBIDDEN', { provider: 'drive', reason: 'not_a_backup' });
    f.trashed = true;
    this.trashedIds.push(id);
  }

  /** Live (not trashed) file names, sorted. */
  names(): string[] {
    return [...this.files.values()].filter(f => !f.trashed).map(f => f.name).sort();
  }
}

function strip(f: BackupDriveFile & { bytes: Uint8Array }): BackupDriveFile {
  const { bytes: _bytes, ...rest } = f;
  void _bytes;
  return { ...rest };
}
