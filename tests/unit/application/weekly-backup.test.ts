import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pingHeartbeat, runWeeklyBackup, safeBackupError, verifyBackupUpload, type WeeklyBackupDeps } from '@/application/weekly-backup';
import { FakeBackupDrive } from '@/integrations/google/fake-backup-drive';
import { FakeBackupRowSource, syntheticBackupTables } from '@/integrations/supabase/fake-backup-source';
import { FakeBackupRunStore } from '@/integrations/supabase/backup-run-store';
import { AppError } from '@/domain/errors';
import { backupWarning } from '@/domain/weekly-backup';

const FOLDER = 'SYNTH_backup_folder';
let drive: FakeBackupDrive, source: FakeBackupRowSource, runs: FakeBackupRunStore, clock: number, pings: boolean[];
const deps = (over: Partial<WeeklyBackupDeps> = {}): WeeklyBackupDeps => ({
  source, drive, runs, folderId: FOLDER, buildCommit: 'abc1234', now: () => clock, ping: async ok => { pings.push(ok); }, ...over,
});
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
beforeEach(() => {
  drive = new FakeBackupDrive([FOLDER]);
  source = new FakeBackupRowSource(syntheticBackupTables());
  clock = Date.parse('2026-11-01T19:00:00Z');
  runs = new FakeBackupRunStore(() => clock);
  pings = [];
});

describe('a successful run', () => {
  it('uploads data then manifest, verifies, records and pings', async () => {
    const result = await runWeeklyBackup(deps(), 'cron', id(1));
    expect(result.status).toBe('success');
    expect(drive.names()).toEqual(['content-studio-backup-2026-11-02-0300.json.gz', 'content-studio-backup-2026-11-02-0300.manifest.json']);
    const status = await runs.status();
    expect(status.lastSuccess).toMatchObject({ status: 'success', fileName: 'content-studio-backup-2026-11-02-0300.json.gz', rowCounts: expect.objectContaining({ posts: 2 }) });
    expect(status.lastSuccess!.sizeBytes).toBeGreaterThan(0);
    expect(pings).toEqual([true]);
    expect(backupWarning(status, clock).level).toBe('none');
  });
  it('stamps both files with the marker and the configured folder', async () => {
    await runWeeklyBackup(deps(), 'manual', id(1));
    for (const f of drive.files.values()) { expect(f.appProperties).toEqual({ contentStudioBackup: 'weekly-v1' }); expect(f.parents).toEqual([FOLDER]); }
  });
  it('replays the same run id instead of backing up twice', async () => {
    await runWeeklyBackup(deps(), 'manual', id(1));
    const again = await runWeeklyBackup(deps(), 'manual', id(1));
    expect(again.status).toBe('replayed');
    expect(drive.files.size).toBe(2);
  });
  it('does not start while another run is in progress', async () => {
    await runs.begin({ id: id(9), trigger: 'cron', startedAt: new Date(clock).toISOString() });
    const result = await runWeeklyBackup(deps(), 'manual', id(2));
    expect(result.status).toBe('busy');
    expect(drive.files.size).toBe(0);
  });
});

describe('retention after a verified run', () => {
  it('keeps the newest 8 and trashes only older marked backups', async () => {
    for (let d = 1; d <= 9; d++) {
      const stem = `content-studio-backup-2026-10-${String(d).padStart(2, '0')}-0300`;
      drive.seed(`${stem}.json.gz`); drive.seed(`${stem}.manifest.json`);
    }
    const stranger = drive.seed('family-photos.zip');
    const lookalike = drive.seed('content-studio-backup-2026-01-01-0300.json.gz', { marked: false });
    const result = await runWeeklyBackup(deps(), 'cron', id(1));
    expect(result.status).toBe('success');
    const live = drive.names();
    expect(live.filter(n => n.startsWith('content-studio-backup-')).length).toBe(8 * 2 + 1);
    expect(live).toContain('content-studio-backup-2026-11-02-0300.json.gz');
    expect(live).not.toContain('content-studio-backup-2026-10-01-0300.json.gz');
    expect(drive.files.get(stranger.id)!.trashed).toBe(false);
    expect(drive.files.get(lookalike.id)!.trashed).toBe(false);
    expect(drive.trashedIds).toHaveLength(4);
  });
  it('treats a pruning failure as a warning, not a failed backup', async () => {
    for (let d = 1; d <= 9; d++) { const s = `content-studio-backup-2026-10-${String(d).padStart(2, '0')}-0300`; drive.seed(`${s}.json.gz`); drive.seed(`${s}.manifest.json`); }
    drive.failTrash = true;
    const result = await runWeeklyBackup(deps(), 'cron', id(1));
    expect(result).toMatchObject({ status: 'success', warnings: 4 });
    expect((await runs.status()).lastSuccess).not.toBeNull();
  });
});

describe('failures never delete old backups', () => {
  const seedOld = () => { for (let d = 1; d <= 9; d++) { const s = `content-studio-backup-2026-10-${String(d).padStart(2, '0')}-0300`; drive.seed(`${s}.json.gz`); drive.seed(`${s}.manifest.json`); } };
  it('a checksum mismatch after upload fails the run and trashes nothing', async () => {
    seedOld();
    drive.corruptMd5 = true;
    const result = await runWeeklyBackup(deps(), 'cron', id(1));
    expect(result).toMatchObject({ status: 'failure', errorMessage: 'CONFLICT: verify_checksum' });
    expect(drive.trashedIds).toEqual([]);
    const status = await runs.status();
    expect(status.lastSuccess).toBeNull();
    expect(status.lastRun).toMatchObject({ status: 'failure', errorMessage: 'CONFLICT: verify_checksum' });
    expect(backupWarning(status, clock).level).toBe('failed');
    expect(pings).toEqual([false]);
  });
  it('an upload error fails the run and trashes nothing', async () => {
    seedOld();
    drive.failUploadAt = 2; // the manifest upload
    const result = await runWeeklyBackup(deps(), 'cron', id(1));
    expect(result.status).toBe('failure');
    expect(drive.trashedIds).toEqual([]);
  });
  it('a database read error fails the run before anything is uploaded', async () => {
    source.failAtPage = 1;
    const result = await runWeeklyBackup(deps(), 'cron', id(1));
    expect(result.status).toBe('failure');
    expect(drive.files.size).toBe(0);
    expect(drive.trashedIds).toEqual([]);
  });
  it('a failed run does not hide an earlier success but still warns', async () => {
    await runWeeklyBackup(deps(), 'cron', id(1));
    clock += 7 * 86_400_000;
    source.failAtPage = source.pages.length + 1;
    await runWeeklyBackup(deps(), 'cron', id(2));
    const status = await runs.status();
    expect(status.lastSuccess!.id).toBe(id(1));
    expect(backupWarning(status, clock).level).toBe('failed');
  });
});

describe('verification', () => {
  it('rejects a wrong size, a trashed file, an altered manifest and an unparsable manifest', async () => {
    const gz = new Uint8Array([1, 2, 3, 4]);
    const manifestBytes = new TextEncoder().encode(JSON.stringify({ format: 'content-studio-backup/1', tables: {} }));
    const mk = async () => {
      const d = new FakeBackupDrive([FOLDER]);
      const props = { contentStudioBackup: 'weekly-v1' };
      const data = await d.uploadBackupFile({ folderId: FOLDER, name: 'content-studio-backup-2026-11-02-0300.json.gz', mimeType: 'application/gzip', bytes: gz, appProperties: props });
      const manifest = await d.uploadBackupFile({ folderId: FOLDER, name: 'content-studio-backup-2026-11-02-0300.manifest.json', mimeType: 'text/plain', bytes: manifestBytes, appProperties: props });
      return { d, data, manifest };
    };
    const ok = await mk();
    await expect(verifyBackupUpload(ok.d, ok, { gz, manifestBytes })).resolves.toBeUndefined();
    await expect(verifyBackupUpload(ok.d, ok, { gz: new Uint8Array([1, 2, 3]), manifestBytes })).rejects.toMatchObject({ details: { reason: 'verify_size' } });
    await expect(verifyBackupUpload(ok.d, ok, { gz: new Uint8Array([9, 9, 9, 9]), manifestBytes })).rejects.toMatchObject({ details: { reason: 'verify_checksum' } });
    await expect(verifyBackupUpload(ok.d, ok, { gz, manifestBytes: new TextEncoder().encode('other') })).rejects.toMatchObject({ details: { reason: 'verify_manifest' } });
    const bad = await mk();
    const junk = new TextEncoder().encode('not json');
    bad.d.files.get(bad.manifest.id)!.bytes = junk;
    await expect(verifyBackupUpload(bad.d, bad, { gz, manifestBytes: junk })).rejects.toMatchObject({ details: { reason: 'verify_manifest_parse' } });
  });
  it('falls back to a full download compare when Drive reports no md5', async () => {
    const gz = new Uint8Array([5, 6, 7]);
    const manifestBytes = new TextEncoder().encode(JSON.stringify({ format: 'content-studio-backup/1', tables: {} }));
    const d = new FakeBackupDrive([FOLDER]);
    const props = { contentStudioBackup: 'weekly-v1' };
    const data = await d.uploadBackupFile({ folderId: FOLDER, name: 'content-studio-backup-2026-11-02-0300.json.gz', mimeType: 'application/gzip', bytes: gz, appProperties: props });
    const manifest = await d.uploadBackupFile({ folderId: FOLDER, name: 'content-studio-backup-2026-11-02-0300.manifest.json', mimeType: 'text/plain', bytes: manifestBytes, appProperties: props });
    d.files.get(data.id)!.md5Checksum = null;
    await expect(verifyBackupUpload(d, { data, manifest }, { gz, manifestBytes })).resolves.toBeUndefined();
    d.files.get(data.id)!.bytes = new Uint8Array([5, 6, 8]);
    await expect(verifyBackupUpload(d, { data, manifest }, { gz, manifestBytes })).rejects.toMatchObject({ details: { reason: 'verify_checksum' } });
  });
});

describe('heartbeat and error text', () => {
  it('a throwing heartbeat never fails the backup', async () => {
    const result = await runWeeklyBackup(deps({ ping: async () => { throw new Error('boom'); } }), 'cron', id(1));
    expect(result.status).toBe('success');
  });
  it('pings the url on success and url/fail on failure, https only, with a timeout, swallowing errors', async () => {
    const f = vi.fn(async () => new Response('ok'));
    await pingHeartbeat('https://hc.example/ping/abc', true, f as unknown as typeof fetch);
    await pingHeartbeat('https://hc.example/ping/abc/', false, f as unknown as typeof fetch);
    expect(f.mock.calls.map(c => (c as unknown as [string])[0])).toEqual(['https://hc.example/ping/abc', 'https://hc.example/ping/abc/fail']);
    expect((f.mock.calls[0] as unknown as [string, RequestInit])[1].signal).toBeInstanceOf(AbortSignal);
    await pingHeartbeat('http://insecure.example/x', true, f as unknown as typeof fetch);
    await pingHeartbeat(undefined, true, f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledTimes(2);
    await expect(pingHeartbeat('https://hc.example/x', true, (async () => { throw new Error('net'); }) as unknown as typeof fetch)).resolves.toBeUndefined();
  });
  it('stores a code and reason only, never a raw provider message', () => {
    expect(safeBackupError(new AppError('PROVIDER_UNAVAILABLE', { reason: 'network' }))).toBe('PROVIDER_UNAVAILABLE: network');
    expect(safeBackupError(new Error('Bearer sk-secret-token https://x.supabase.co key=abc'))).toBe('UNKNOWN: unexpected error');
    expect(safeBackupError(new AppError('CONFLICT', { reason: 'has spaces and https://leak.example/?k=v' }))).toBe('CONFLICT');
  });
});
