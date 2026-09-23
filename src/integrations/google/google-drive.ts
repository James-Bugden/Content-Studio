import 'server-only';
import type { Capability } from '@/domain/capability';
import { AppError } from '@/domain/errors';
import { DRIVE_CREATE_MAX_BYTES, DRIVE_FILE_NAME, type DriveCreateInput, type DriveFileMeta, type DriveGateway } from '@/application/ports';
import { SCOPES, googleError, withReadRetry, type ServiceAccountTokens } from './service-account';

/**
 * Google Drive v3 gateway (CS-004).
 *
 * Revision is Drive's monotonically increasing file `version`. Drive offers no
 * conditional media update, so `writeText` re-reads metadata immediately before
 * uploading and refuses on mismatch. A concurrent edit landing inside that single
 * round trip can still be overwritten; the saga re-reads afterwards and the gap is
 * recorded in docs/implementation/atomicity.md.
 */
const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FIELDS = 'id,mimeType,modifiedTime,version,size,trashed';
const FILE_ID = /^[A-Za-z0-9_-]{10,200}$/;

export class GoogleDriveGateway implements DriveGateway {
  constructor(
    private readonly tokens: ServiceAccountTokens,
    private readonly writeEnabled: boolean,
    private readonly fetchImpl: typeof fetch = fetch,
    /** Folder new visual assets are uploaded into (`CS_ASSET_FOLDER_ID`). */
    private readonly assetFolderId?: string,
  ) {}

  capability(): Capability {
    return { provider: 'drive', mode: 'live', state: this.writeEnabled ? 'ready' : 'read_only' };
  }

  private async headers(): Promise<Record<string, string>> {
    const token = await this.tokens.token([this.writeEnabled ? SCOPES.driveWrite : SCOPES.driveRead]);
    return { authorization: `Bearer ${token}` };
  }

  private check(fileId: string): void {
    if (!FILE_ID.test(fileId)) throw new AppError('VALIDATION_FAILED', { provider: 'drive', reason: 'file_id' });
  }

  async getMeta(fileId: string): Promise<DriveFileMeta> {
    this.check(fileId);
    return withReadRetry(async () => {
      const res = await this.fetchImpl(`${API}/${fileId}?fields=${FIELDS}&supportsAllDrives=true`, { headers: await this.headers() });
      if (!res.ok) throw googleError(res.status, 'drive');
      const b = (await res.json()) as { id: string; mimeType: string; modifiedTime: string; version: string; size?: string; trashed?: boolean };
      return { id: b.id, mimeType: b.mimeType, modifiedTime: b.modifiedTime, revision: String(b.version), size: Number(b.size ?? 0), trashed: Boolean(b.trashed) };
    });
  }

  async readText(fileId: string): Promise<{ text: string; meta: DriveFileMeta }> {
    const meta = await this.getMeta(fileId);
    if (meta.trashed) throw new AppError('NOT_FOUND', { provider: 'drive', reason: 'trashed' });
    if (!/^text\/(markdown|plain|x-markdown)$/.test(meta.mimeType)) throw new AppError('VALIDATION_FAILED', { provider: 'drive', reason: 'not_text' });
    if (meta.size > 5_000_000) throw new AppError('VALIDATION_FAILED', { provider: 'drive', reason: 'too_large' });
    const text = await withReadRetry(async () => {
      const res = await this.fetchImpl(`${API}/${fileId}?alt=media&supportsAllDrives=true`, { headers: await this.headers() });
      if (!res.ok) throw googleError(res.status, 'drive');
      return new TextDecoder('utf-8', { fatal: true }).decode(await res.arrayBuffer());
    });
    return { text, meta };
  }

  async writeText(fileId: string, text: string, expectedRevision: string): Promise<DriveFileMeta> {
    if (!this.writeEnabled) throw new AppError('CONFIG_MISSING', { provider: 'drive', reason: 'write_disabled' });
    const before = await this.getMeta(fileId);
    if (before.revision !== expectedRevision) throw new AppError('STALE_READ', { provider: 'drive' });
    const res = await this.fetchImpl(`${UPLOAD}/${fileId}?uploadType=media&supportsAllDrives=true&fields=${FIELDS}`, {
      method: 'PATCH',
      headers: { ...(await this.headers()), 'content-type': `${before.mimeType}; charset=utf-8` },
      body: text,
    });
    if (!res.ok) throw googleError(res.status, 'drive');
    const b = (await res.json()) as { id: string; mimeType: string; modifiedTime: string; version: string; size?: string; trashed?: boolean };
    return { id: b.id, mimeType: b.mimeType, modifiedTime: b.modifiedTime, revision: String(b.version), size: Number(b.size ?? 0), trashed: Boolean(b.trashed) };
  }

  /**
   * Multipart upload of a new asset into the configured asset folder (CS-012).
   * The parent folder comes from configuration, never from a Sheet cell. The web
   * link is built from the returned id, not taken from the provider payload.
   */
  async createFile(input: DriveCreateInput): Promise<DriveFileMeta & { webLink: string }> {
    if (!this.writeEnabled) throw new AppError('CONFIG_MISSING', { provider: 'drive', reason: 'write_disabled' });
    const folderId = input.folderId ?? this.assetFolderId;
    if (!folderId) throw new AppError('CONFIG_MISSING', { provider: 'drive', reason: 'asset_folder' });
    if (!FILE_ID.test(folderId)) throw new AppError('VALIDATION_FAILED', { provider: 'drive', reason: 'folder_id' });
    if (!DRIVE_FILE_NAME.test(input.name)) throw new AppError('VALIDATION_FAILED', { provider: 'drive', reason: 'file_name' });
    if (input.mimeType !== 'image/svg+xml' && input.mimeType !== 'image/png') throw new AppError('VALIDATION_FAILED', { provider: 'drive', reason: 'mime_type' });
    if (input.bytes.length === 0 || input.bytes.length > DRIVE_CREATE_MAX_BYTES) throw new AppError('VALIDATION_FAILED', { provider: 'drive', reason: 'size' });

    const boundary = `cs_${crypto.randomUUID().replace(/-/g, '')}`;
    const metadata = JSON.stringify({ name: input.name, mimeType: input.mimeType, parents: [folderId] });
    const encoder = new TextEncoder();
    const head = encoder.encode(
      `--${boundary}\r\ncontent-type: application/json; charset=utf-8\r\n\r\n${metadata}\r\n--${boundary}\r\ncontent-type: ${input.mimeType}\r\n\r\n`,
    );
    const tail = encoder.encode(`\r\n--${boundary}--\r\n`);
    const body = new Uint8Array(head.length + input.bytes.length + tail.length);
    body.set(head, 0);
    body.set(input.bytes, head.length);
    body.set(tail, head.length + input.bytes.length);

    // Not retried: a lost response could otherwise create a second file.
    const res = await this.fetchImpl(`${UPLOAD}?uploadType=multipart&supportsAllDrives=true&fields=${FIELDS}`, {
      method: 'POST',
      headers: { ...(await this.headers()), 'content-type': `multipart/related; boundary=${boundary}` },
      body: body as unknown as BodyInit,
    });
    if (!res.ok) throw googleError(res.status, 'drive');
    const b = (await res.json()) as { id: string; mimeType: string; modifiedTime: string; version: string; size?: string; trashed?: boolean };
    if (typeof b.id !== 'string' || !FILE_ID.test(b.id)) throw new AppError('PROVIDER_UNAVAILABLE', { provider: 'drive', reason: 'bad_create_response' });
    return {
      id: b.id,
      mimeType: b.mimeType,
      modifiedTime: b.modifiedTime,
      revision: String(b.version),
      size: Number(b.size ?? input.bytes.length),
      trashed: Boolean(b.trashed),
      webLink: `https://drive.google.com/file/d/${b.id}/view`,
    };
  }

  async readBytes(fileId: string, maxBytes: number): Promise<{ bytes: Uint8Array; meta: DriveFileMeta }> {
    const meta = await this.getMeta(fileId);
    if (meta.trashed) throw new AppError('NOT_FOUND', { provider: 'drive', reason: 'trashed' });
    if (meta.size > maxBytes) throw new AppError('VALIDATION_FAILED', { provider: 'drive', reason: 'too_large' });
    const bytes = await withReadRetry(async () => {
      const res = await this.fetchImpl(`${API}/${fileId}?alt=media&supportsAllDrives=true`, { headers: await this.headers() });
      if (!res.ok) throw googleError(res.status, 'drive');
      return new Uint8Array(await res.arrayBuffer());
    });
    if (bytes.length > maxBytes) throw new AppError('VALIDATION_FAILED', { provider: 'drive', reason: 'too_large' });
    return { bytes, meta };
  }
}
