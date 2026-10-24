import 'server-only';
import type { ContentBackupSnapshot, PrivateBackupFolder } from '@/application/content-backup';
import { AppError } from '@/domain/errors';

/** Private-folder fake only. No Drive credential, folder ID or live upload. */
export class FakePrivateBackupFolder implements PrivateBackupFolder {
  readonly files = new Map<string, Uint8Array>();
  private readonly names = new Map<string, string>();
  private next = 0;
  constructor(public privateFolder = true) {}
  async assertPrivate() { if (!this.privateFolder) throw new AppError('FORBIDDEN', { reason: 'backup_folder_not_private' }); }
  async create(name: string, _mime: 'application/gzip' | 'application/json', bytes: Uint8Array) {
    await this.assertPrivate();
    const old = this.names.get(name);
    if (old) {
      if (!Buffer.from(this.files.get(old)!).equals(Buffer.from(bytes))) throw new AppError('CONFLICT');
      return old;
    }
    const id = `synthetic-backup-${++this.next}`;
    this.files.set(id, bytes.slice()); this.names.set(name, id); return id;
  }
  async read(id: string) { await this.assertPrivate(); const value = this.files.get(id); if (!value) throw new AppError('NOT_FOUND'); return value.slice(); }
}
export const emptyBackupSnapshot = (): ContentBackupSnapshot => ({ posts: [], schedule: [], workflow_settings: [], row_history: [], operations: [], audit_events: [] });
