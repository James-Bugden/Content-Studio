import { describe, expect, it, vi } from 'vitest';
import { GoogleDriveGateway } from '@/integrations/google/google-drive';
import type { ServiceAccountTokens } from '@/integrations/google/service-account';
import { FakeBackupDrive } from '@/integrations/google/fake-backup-drive';

const FOLDER = 'SYNTH_backup_folder';
const tokens = { token: async () => 'synthetic-token' } as unknown as ServiceAccountTokens;
const NAME = 'content-studio-backup-2026-11-02-0300.json.gz';
const MANIFEST = 'content-studio-backup-2026-11-02-0300.manifest.json';
const marker = { contentStudioBackup: 'weekly-v1' };
const folderOk = { id: FOLDER, mimeType: 'application/vnd.google-apps.folder', trashed: false };
const created = { id: 'SYNTH_created_file', name: NAME, size: '4', md5Checksum: 'abc', createdTime: '2026-11-01T19:00:00Z', trashed: false, parents: [FOLDER], appProperties: marker };

type Call = { url: string; init?: RequestInit };
function gateway(handler: (url: string, init?: RequestInit) => Response, writeEnabled = true) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => { calls.push({ url, init }); return handler(url, init); });
  return { gw: new GoogleDriveGateway(tokens, writeEnabled, fetchImpl as unknown as typeof fetch), calls };
}
const happy = (url: string) => {
  if (url.includes('/permissions')) return Response.json({ permissions: [{ type: 'user' }] });
  if (url.includes('uploadType=multipart')) return Response.json(created);
  return Response.json(folderOk);
};
const input = { folderId: FOLDER, name: NAME, mimeType: 'application/gzip' as const, bytes: new Uint8Array([1, 2, 3, 4]), appProperties: marker };

describe('Google Drive guarded gzip upload', () => {
  it('uploads gzip with the marker and parent in the metadata, after checking the folder', async () => {
    const { gw, calls } = gateway(happy);
    const file = await gw.uploadBackupFile(input);
    expect(file).toMatchObject({ id: 'SYNTH_created_file', md5Checksum: 'abc', size: 4, appProperties: marker });
    const upload = calls.find(c => c.url.includes('uploadType=multipart'))!;
    expect(upload.init!.method).toBe('POST');
    const body = Buffer.from(upload.init!.body as Uint8Array).toString('latin1');
    expect(body).toContain('"parents":["SYNTH_backup_folder"]');
    expect(body).toContain('"appProperties":{"contentStudioBackup":"weekly-v1"}');
    expect(body).toContain('content-type: application/gzip');
    expect(calls.findIndex(c => c.url.includes('/permissions'))).toBeLessThan(calls.findIndex(c => c.url.includes('uploadType=multipart')));
  });
  it('accepts the plain-text manifest', async () => {
    const { gw } = gateway(happy);
    await expect(gw.uploadBackupFile({ ...input, name: MANIFEST, mimeType: 'text/plain' })).resolves.toBeDefined();
  });
  it.each([
    ['write disabled', { }, false, 'CONFIG_MISSING'],
    ['wrong name', { name: 'notes.json.gz' }, true, 'VALIDATION_FAILED'],
    ['image mime', { mimeType: 'image/png' as never }, true, 'VALIDATION_FAILED'],
    ['mime not matching name', { name: MANIFEST }, true, 'VALIDATION_FAILED'],
    ['empty file', { bytes: new Uint8Array() }, true, 'VALIDATION_FAILED'],
    ['missing marker', { appProperties: {} }, true, 'VALIDATION_FAILED'],
    ['bad folder id', { folderId: 'x' }, true, 'VALIDATION_FAILED'],
  ])('refuses %s before any upload', async (_label, over, writable, code) => {
    const { gw, calls } = gateway(happy, writable);
    await expect(gw.uploadBackupFile({ ...input, ...over })).rejects.toMatchObject({ code });
    expect(calls.some(c => c.url.includes('uploadType=multipart'))).toBe(false);
  });
  it('refuses a file over the 100 MB cap', async () => {
    const { gw, calls } = gateway(happy);
    await expect(gw.uploadBackupFile({ ...input, bytes: { length: 100 * 1024 * 1024 + 1 } as unknown as Uint8Array })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(calls).toHaveLength(0);
  });
  it('refuses a folder shared by link or domain, and a non-folder', async () => {
    for (const permission of ['anyone', 'domain']) {
      const { gw, calls } = gateway(url => url.includes('/permissions') ? Response.json({ permissions: [{ type: 'user' }, { type: permission }] }) : Response.json(folderOk));
      await expect(gw.uploadBackupFile(input)).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(calls.some(c => c.url.includes('uploadType=multipart'))).toBe(false);
    }
    const { gw } = gateway(() => Response.json({ id: FOLDER, mimeType: 'text/plain', trashed: false }));
    await expect(gw.uploadBackupFile(input)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('does not retry a failed upload (a lost response could duplicate the file)', async () => {
    const { gw, calls } = gateway(url => url.includes('uploadType=multipart') ? new Response('{}', { status: 503 }) : happy(url));
    await expect(gw.uploadBackupFile(input)).rejects.toBeDefined();
    expect(calls.filter(c => c.url.includes('uploadType=multipart'))).toHaveLength(1);
  });
});

describe('Google Drive backup listing, reading and trashing', () => {
  it('lists only marked, prefixed files in the folder, following pages', async () => {
    const pages = [Response.json({ files: [created], nextPageToken: 'T2' }), Response.json({ files: [{ ...created, id: 'SYNTH_created_file2' }] })];
    const { gw, calls } = gateway(() => pages.shift()!);
    expect((await gw.listBackupFiles(FOLDER)).map(f => f.id)).toEqual(['SYNTH_created_file', 'SYNTH_created_file2']);
    const q = decodeURIComponent(calls[0]!.url.replaceAll('+', ' '));
    expect(q).toContain(`'${FOLDER}' in parents`);
    expect(q).toContain("appProperties has { key='contentStudioBackup' and value='weekly-v1' }");
    expect(q).toContain('trashed=false');
    expect(calls[1]!.url).toContain('pageToken=T2');
  });
  it('trashes (not deletes) a marked backup in the folder', async () => {
    const { gw, calls } = gateway((url, init) => init?.method === 'PATCH' ? Response.json({ id: 'x' }) : Response.json(created));
    await gw.trashBackupFile('SYNTH_created_file', FOLDER);
    const patch = calls.find(c => c.init?.method === 'PATCH')!;
    expect(JSON.parse(String(patch.init!.body))).toEqual({ trashed: true });
    expect(calls.some(c => c.init?.method === 'DELETE')).toBe(false);
  });
  it.each([
    ['unmarked', { ...created, appProperties: null }],
    ['wrong marker value', { ...created, appProperties: { contentStudioBackup: 'x' } }],
    ['foreign name', { ...created, name: 'family.zip' }],
    ['other folder', { ...created, parents: ['SYNTH_other_folder'] }],
  ])('refuses to trash a %s file', async (_label, meta) => {
    const { gw, calls } = gateway(() => Response.json(meta));
    await expect(gw.trashBackupFile('SYNTH_created_file', FOLDER)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(calls.some(c => c.init?.method === 'PATCH')).toBe(false);
  });
  it('reads bytes only of marked backups within the size limit', async () => {
    const { gw } = gateway(url => url.includes('alt=media') ? new Response(new Uint8Array([1, 2, 3, 4])) : Response.json(created));
    expect(Array.from(await gw.readBackupBytes('SYNTH_created_file', 100))).toEqual([1, 2, 3, 4]);
    await expect(gw.readBackupBytes('SYNTH_created_file', 2)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const foreign = gateway(() => Response.json({ ...created, appProperties: null }));
    await expect(foreign.gw.readBackupBytes('SYNTH_created_file', 100)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('FakeBackupDrive mirrors the guards', () => {
  it('rejects the same bad uploads and trashes only marked files', async () => {
    const d = new FakeBackupDrive([FOLDER]);
    await expect(d.uploadBackupFile({ ...input, name: 'x.json.gz' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(d.uploadBackupFile({ ...input, folderId: 'other' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const mine = await d.uploadBackupFile(input);
    const foreign = d.seed('x.txt', { marked: false });
    await d.trashBackupFile(mine.id, FOLDER);
    await expect(d.trashBackupFile(foreign.id, FOLDER)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
