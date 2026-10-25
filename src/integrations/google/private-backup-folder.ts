import 'server-only';
import { createHash } from 'node:crypto';
import { AppError } from '@/domain/errors';
import type { PrivateBackupFolder } from '@/application/content-backup';
import { SCOPES, googleError, type ServiceAccountTokens } from './service-account';

const API = 'https://www.googleapis.com/drive/v3/files';
const validId = /^[A-Za-z0-9_-]{10,200}$/;
/** Never creates permissions, public URLs, or updates an existing file. Only
 * the configured private folder and its direct children are accepted. */
export class GooglePrivateBackupFolder implements PrivateBackupFolder {
  constructor(private readonly tokens: ServiceAccountTokens, private readonly folderId: string, private readonly fetchImpl: typeof fetch = fetch) {
    if (!validId.test(folderId)) throw new AppError('CONFIG_MISSING');
  }
  private async request(url: string, init: RequestInit = {}) {
    const response = await this.fetchImpl(url, { ...init, cache: 'no-store', signal: AbortSignal.timeout(10_000),
      headers: { authorization: `Bearer ${await this.tokens.token([SCOPES.driveWrite])}`, ...init.headers } });
    if (!response.ok) throw googleError(response.status, 'drive');
    return response;
  }
  async assertPrivate() {
    const meta = await (await this.request(`${API}/${this.folderId}?fields=id,mimeType,trashed,driveId&supportsAllDrives=true`)).json();
    // Service accounts cannot own files/use personal storage. A private shared
    // drive supplies storage without impersonating a human. Inspect BOTH its
    // membership and the folder's ACL, including inherited permissions.
    if (meta.id !== this.folderId || meta.mimeType !== 'application/vnd.google-apps.folder' || meta.trashed
      || typeof meta.driveId !== 'string' || !validId.test(meta.driveId)) throw new AppError('FORBIDDEN');
    await this.privatePermissions(meta.driveId);
    await this.privatePermissions(this.folderId);
  }
  private async privatePermissions(id: string) {
    const data = await (await this.request(`${API}/${id}/permissions?fields=permissions(type,permissionDetails),nextPageToken&pageSize=100&supportsAllDrives=true`)).json();
    if (!Array.isArray(data.permissions) || !data.permissions.length || data.nextPageToken
      || data.permissions.some((p: { type?: string }) => p.type !== 'user')) throw new AppError('FORBIDDEN', { reason: 'backup_folder_not_private' });
  }
  async create(name: string, mimeType: 'application/gzip' | 'application/json', bytes: Uint8Array) {
    if (!/^[a-z0-9-]+\.(?:jsonl\.gz|json)$/.test(name)) throw new AppError('VALIDATION_FAILED');
    await this.assertPrivate();
    const query = new URLSearchParams({ q: `'${this.folderId}' in parents and trashed=false and name='${name}'`, fields: 'files(id),nextPageToken', pageSize: '100', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' });
    const existing = await (await this.request(`${API}?${query}`)).json();
    if (!Array.isArray(existing.files) || existing.nextPageToken || existing.files.length > 1) throw new AppError('CONFLICT');
    if (existing.files.length) {
      const id = existing.files[0].id;
      if (!Buffer.from(await this.read(id)).equals(Buffer.from(bytes))) throw new AppError('CONFLICT');
      return id as string;
    }
    const boundary = `cs${createHash('sha256').update(bytes).digest('hex')}`;
    const metadata = { name, mimeType, parents: [this.folderId] };
    const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`), Buffer.from(bytes), Buffer.from(`\r\n--${boundary}--`)]);
    const result = await (await this.request('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id&supportsAllDrives=true', {
      method: 'POST', headers: { 'content-type': `multipart/related; boundary=${boundary}` }, body,
    })).json();
    if (typeof result.id !== 'string' || !validId.test(result.id)) throw new AppError('PROVIDER_UNAVAILABLE');
    await this.read(result.id); // Verify placement/permissions before returning a handle.
    return result.id as string;
  }
  async read(id: string) {
    if (!validId.test(id) || id === this.folderId) throw new AppError('VALIDATION_FAILED');
    const meta = await (await this.request(`${API}/${id}?fields=id,parents,trashed,size&supportsAllDrives=true`)).json();
    if (meta.id !== id || meta.trashed || !Array.isArray(meta.parents) || meta.parents.length !== 1 || meta.parents[0] !== this.folderId
      || !/^\d+$/.test(String(meta.size)) || Number(meta.size) > 256 * 1024 * 1024) throw new AppError('FORBIDDEN');
    await this.privatePermissions(id);
    return new Uint8Array(await (await this.request(`${API}/${id}?alt=media&supportsAllDrives=true`)).arrayBuffer());
  }
}
