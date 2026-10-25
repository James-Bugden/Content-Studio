import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GooglePrivateBackupFolder } from '@/integrations/google/private-backup-folder';
import { createContentBackup, verifyContentBackup } from '@/application/content-backup';
import { emptyBackupSnapshot } from '@/integrations/supabase/fake-content-backup';
import type { ServiceAccountTokens } from '@/integrations/google/service-account';

const allowed = ['svc@example.com', 'owner@example.com'];
const permission = { type: 'user', emailAddress: allowed[0], role: 'writer', permissionDetails: [{ permissionType: 'member', role: 'writer' }] };
const folderId = 'synthetic_private_folder';
let files: Map<string, { name: string; bytes: Uint8Array }>, request: ReturnType<typeof vi.fn<typeof fetch>>;
const tokens = { token: vi.fn(async () => 'synthetic-google-token') } as unknown as ServiceAccountTokens;
beforeEach(() => {
  files = new Map();
  request = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    expect(url.origin).toBe('https://www.googleapis.com');
    expect(init?.headers).toMatchObject({ authorization: 'Bearer synthetic-google-token' });
    if (url.pathname.includes('/upload/')) {
      const bytes = Buffer.from(init!.body as Uint8Array), header = bytes.toString('utf8');
      const match = /\r\n\r\n(\{"name"[\s\S]*?\})\r\n--/.exec(header)!;
      const metadata = JSON.parse(match[1]!); expect(metadata.parents).toEqual([folderId]);
      expect(metadata).not.toHaveProperty('permissions');
      const marker = Buffer.from(`Content-Type: ${metadata.mimeType}\r\n\r\n`), start = bytes.indexOf(marker) + marker.length;
      const boundary = String((init!.headers as Record<string, string>)['content-type']).split('boundary=')[1]!;
      const end = bytes.lastIndexOf(Buffer.from(`\r\n--${boundary}--`));
      const id = `synthetic_file_${files.size + 1}`;
      files.set(id, { name: metadata.name, bytes: bytes.subarray(start, end) });
      return Response.json({ id });
    }
    if (url.pathname.endsWith('/permissions')) return Response.json({ permissions: [permission] });
    const id = url.pathname.split('/').at(-1)!;
    if (id === folderId) return Response.json({ id, mimeType: 'application/vnd.google-apps.folder', trashed: false, driveId: 'synthetic_shared_drive' });
    if (id === 'files') {
      const name = /name='([^']+)'/.exec(url.searchParams.get('q')!)![1];
      return Response.json({ files: [...files].filter(([, v]) => v.name === name).map(([id]) => ({ id })) });
    }
    const file = files.get(id);
    if (!file) return new Response(null, { status: 404 });
    if (url.searchParams.get('alt') === 'media') return new Response(Buffer.from(file.bytes));
    return Response.json({ id, parents: [folderId], trashed: false, size: String(file.bytes.length) });
  });
});
describe('DB-10 real private service-account Drive backup transport', () => {
  it.each(['synthetic_shared_drive', folderId, 'synthetic_file_1'])('checks permissions on %s, including pagination and unexpected principals', async id => {
    const original = request.getMockImplementation()!;
    files.set('synthetic_file_1', { name: 'synthetic.json', bytes: Buffer.from('{}') });
    const folder = new GooglePrivateBackupFolder(tokens, folderId, request, allowed);
    const run = () => id === 'synthetic_file_1' ? folder.read(id) : folder.assertPrivate();
    for (const bad of [
      { permissions: [permission], nextPageToken: 'synthetic-next-page' },
      { permissions: [{ ...permission, type: 'anyone' }] },
      { permissions: [{ ...permission, type: 'domain' }] },
      { permissions: [{ ...permission, emailAddress: 'unexpected@example.com' }] },
      { permissions: [{ ...permission, role: 'unknown' }] },
      { permissions: [{ ...permission, permissionDetails: [] }] },
    ]) {
      request.mockImplementation(async (url, init) => new URL(String(url)).pathname.endsWith(`/${id}/permissions`) ? Response.json(bad) : original(url, init));
      await expect(run()).rejects.toMatchObject({ code: 'FORBIDDEN', details: { reason: 'backup_folder_not_private' } });
    }
  });
  it.each([undefined, '', 'bad'])('refuses missing or invalid shared-drive membership identity: %s', async driveId => {
    const original = request.getMockImplementation()!;
    request.mockImplementation(async (url, init) => new URL(String(url)).pathname.endsWith(`/${folderId}`)
      ? Response.json({ id: folderId, mimeType: 'application/vnd.google-apps.folder', trashed: false, driveId }) : original(url, init));
    await expect(new GooglePrivateBackupFolder(tokens, folderId, request, allowed).assertPrivate()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(request.mock.calls.some(([url]) => String(url).includes('/permissions'))).toBe(false);
  });
  it('creates private immutable gzip archives, verifies all six hashes and manifest, and replays same-name bytes', async () => {
    const folder = new GooglePrivateBackupFolder(tokens, folderId, request, allowed);
    const journal = { lastVerified: null, failureSince: null };
    const snapshot = emptyBackupSnapshot(); snapshot.posts.push({ library_id: 'SYN-001', draft_content: 'Synthetic\r\n繁體中文  ' });
    const result = await createContentBackup({ snapshot: async () => snapshot }, folder, journal);
    expect(files.size).toBe(7);
    expect((await verifyContentBackup(folder, result.manifestId, result.manifestHash)).snapshot).toEqual(snapshot);
    const first = [...files][0]!;
    expect(await folder.create(first[1].name, 'application/gzip', first[1].bytes)).toBe(first[0]);
    await expect(folder.create(first[1].name, 'application/gzip', Buffer.from('Synthetic different bytes'))).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(7);
    expect(JSON.stringify(request.mock.calls)).not.toContain('webViewLink');
  });
  it.each(['anyone', 'domain', 'group', undefined])('refuses public/unknown/incompletely measured permissions: %s', async type => {
    const original = request.getMockImplementation()!;
    request.mockImplementation(async (url, init) => String(url).includes('/permissions') ? Response.json({ permissions: [{ type }] }) : original(url, init));
    await expect(new GooglePrivateBackupFolder(tokens, folderId, request, allowed).assertPrivate()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(files.size).toBe(0);
  });
  it.each([429, 500])('keeps the previous verified backup on Drive %s', async status => {
    const folder = new GooglePrivateBackupFolder(tokens, folderId, request, allowed), journal = { lastVerified: null, failureSince: null };
    const previous = await createContentBackup({ snapshot: async () => emptyBackupSnapshot() }, folder, journal);
    request.mockResolvedValue(new Response(null, { status }));
    await expect(createContentBackup({ snapshot: async () => emptyBackupSnapshot() }, folder, journal)).rejects.toBeDefined();
    expect(journal.lastVerified).toEqual(previous); expect(journal.failureSince).not.toBeNull();
  });
  it('refuses reading a file outside the configured folder even with a valid private handle', async () => {
    request.mockResolvedValue(Response.json({ id: 'synthetic_other_file', parents: ['synthetic_other_folder'], size: '1' }));
    await expect(new GooglePrivateBackupFolder(tokens, folderId, request, allowed).read('synthetic_other_file')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
