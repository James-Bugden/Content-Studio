import { describe, expect, it } from 'vitest';
import { createContentBackup, retainedBackups, type VerifiedBackup, type BackupJournal } from '@/application/content-backup';
import { FakePrivateBackupFolder, emptyBackupSnapshot } from '@/integrations/supabase/fake-content-backup';

describe('private backup archive contract', () => {
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
