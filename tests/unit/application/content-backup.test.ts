import { describe, expect, it, vi } from 'vitest';
import { BACKUP_TABLES, createContentBackup, verifyContentBackup, retainedBackups, type VerifiedBackup, type BackupJournal } from '@/application/content-backup';
import { FakePrivateBackupFolder, emptyBackupSnapshot } from '@/integrations/supabase/fake-content-backup';
import { AppError } from '@/domain/errors';

describe('private backup archive contract', () => {
  it.each(['manifest', ...BACKUP_TABLES])('verifies the uploaded %s at creation before advancing backup freshness', async target => {
    const folder = new FakePrivateBackupFolder(), journal: BackupJournal = { lastVerified: null, failureSince: null };
    const source = { snapshot: async () => emptyBackupSnapshot() };
    const previous = await createContentBackup(source, folder, journal, 1000);
    const read = folder.read.bind(folder), create = folder.create.bind(folder);
    let corruptId = '';
    vi.spyOn(folder, 'create').mockImplementation(async (name, mime, bytes) => {
      const id = await create(name, mime, bytes);
      if (name.endsWith(target === 'manifest' ? '-manifest.json' : `-${target.replaceAll('_', '-')}.jsonl.gz`)) corruptId = id;
      return id;
    });
    vi.spyOn(folder, 'read').mockImplementation(async id => {
      const bytes = await read(id);
      return id === corruptId ? new Uint8Array([...bytes, 0]) : bytes;
    });
    await expect(createContentBackup(source, folder, journal, 2000)).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'backup_integrity' } });
    expect(corruptId).not.toBe(''); expect(journal.lastVerified).toBe(previous); expect(journal.failureSince).toBe(2000);
  });
  it('checks private-folder authorization at verification even with an independently readable folder port', async () => {
    const folder = new FakePrivateBackupFolder(), journal: BackupJournal = { lastVerified: null, failureSince: null };
    const backup = await createContentBackup({ snapshot: async () => emptyBackupSnapshot() }, folder, journal);
    const read = vi.fn(folder.read.bind(folder));
    const unsafeFolder = { create: folder.create.bind(folder), read, assertPrivate: async () => { throw new AppError('FORBIDDEN'); } };
    await expect(verifyContentBackup(unsafeFolder, backup.manifestId, backup.manifestHash)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(read).not.toHaveBeenCalled();
  });
  it('uses immutable new files each run and supports empty six-table snapshots', async () => {
    const folder = new FakePrivateBackupFolder(), journal: BackupJournal = { lastVerified: null, failureSince: null };
    const source = { snapshot: async () => emptyBackupSnapshot() };
    const a = await createContentBackup(source, folder, journal), b = await createContentBackup(source, folder, journal);
    expect(a.manifestId).not.toBe(b.manifestId); expect(folder.files.size).toBe(14);
    expect(Object.values(a.manifest.files).every(f => f.rows === 0)).toBe(true);
    expect(await folder.create('synthetic-replay.json', 'application/json', new Uint8Array([1]))).toBe(await folder.create('synthetic-replay.json', 'application/json', new Uint8Array([1])));
    await expect(folder.create('synthetic-replay.json', 'application/json', new Uint8Array([2]))).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('keeps 30 daily snapshots and first monthly snapshots for 12 months in Taipei', () => {
    const now = Date.parse('2026-10-31T19:00:00Z'); // Nov 1 Taipei
    const backups = Array.from({ length: 500 }, (_, i) => ({ manifestId: `synthetic-${i}`, verifiedAt: now - (499 - i) * 86400_000 } as VerifiedBackup));
    const retained = retainedBackups(backups, now);
    for (const b of backups.slice(-30)) expect(retained).toContain(b.manifestId);
    expect(retained).not.toContain(backups[0]!.manifestId);
    const firstOct = backups.find(b => new Date(b.verifiedAt + 8 * 3600_000).toISOString().startsWith('2026-10-01'))!;
    expect(retained).toContain(firstOct.manifestId);
    expect(retained.length).toBeLessThanOrEqual(42);
  });
});
