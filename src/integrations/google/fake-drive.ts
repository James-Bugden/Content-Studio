import 'server-only';
import type { Capability } from '@/domain/capability';
import { AppError, type ErrorCode } from '@/domain/errors';
import { SYNTH_MARKDOWN } from '@/fixtures/synthetic';
import { DRIVE_CREATE_MAX_BYTES, DRIVE_FILE_NAME, type DriveCreateInput, type DriveFileMeta, type DriveGateway } from '@/application/ports';

/**
 * In-memory Drive with revisions, trashed/moved files and failure injection.
 * Text files are stored as strings so exact Unicode round-trips are testable.
 */
type FakeFile = { text?: string; bytes?: Uint8Array; mimeType: string; version: number; modifiedTime: string; trashed: boolean };

export type DriveFailure = { op: 'meta' | 'read' | 'write'; code: ErrorCode; fileId?: string; times?: number };

/** A 1x1 transparent PNG, synthetic. */
const TINY_PNG = Uint8Array.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120,
  156, 99, 0, 1, 0, 0, 5, 0, 1, 13, 10, 45, 180, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
]);

export class FakeDriveGateway implements DriveGateway {
  private files = new Map<string, FakeFile>();
  private failures: DriveFailure[] = [];
  readonly writes: { fileId: string; text: string }[] = [];
  readonly created: { id: string; name: string; mimeType: string; folderId?: string }[] = [];
  private createdCount = 0;
  /** Called between the gateway's pre-write metadata check and the write (race simulation). */
  beforeWrite: ((fileId: string) => void) | null = null;
  private clock = Date.parse('2026-09-23T00:00:00Z');

  constructor(seed: Record<string, string> = SYNTH_MARKDOWN) {
    for (const [id, text] of Object.entries(seed)) this.files.set(id, { text, mimeType: 'text/markdown', version: 1, modifiedTime: this.tick(), trashed: false });
    this.files.set('SYNTH_asset_researched_range_r02.png', { bytes: TINY_PNG, mimeType: 'image/png', version: 1, modifiedTime: this.tick(), trashed: false });
    this.files.set('SYNTH_asset_script.svg', { bytes: new TextEncoder().encode('<svg onload="alert(1)"/>'), mimeType: 'image/svg+xml', version: 1, modifiedTime: this.tick(), trashed: false });
  }

  capability(): Capability {
    return { provider: 'drive', mode: 'fake', state: 'ready' };
  }

  private tick(): string {
    this.clock += 1000;
    return new Date(this.clock).toISOString();
  }

  failNext(f: DriveFailure): void {
    this.failures.push({ times: 1, ...f });
  }

  private maybeFail(op: DriveFailure['op'], fileId: string): void {
    const i = this.failures.findIndex((f) => f.op === op && (!f.fileId || f.fileId === fileId));
    if (i < 0) return;
    const f = this.failures[i]!;
    f.times = (f.times ?? 1) - 1;
    if (f.times <= 0) this.failures.splice(i, 1);
    throw new AppError(f.code, { provider: 'drive', injected: true });
  }

  externalEdit(fileId: string, text: string): void {
    const f = this.files.get(fileId)!;
    this.files.set(fileId, { ...f, text, version: f.version + 1, modifiedTime: this.tick() });
  }

  trash(fileId: string): void {
    const f = this.files.get(fileId)!;
    this.files.set(fileId, { ...f, trashed: true });
  }

  remove(fileId: string): void {
    this.files.delete(fileId);
  }

  textOf(fileId: string): string {
    return this.files.get(fileId)?.text ?? '';
  }

  private meta(fileId: string): DriveFileMeta {
    const f = this.files.get(fileId);
    if (!f) throw new AppError('NOT_FOUND', { provider: 'drive' });
    return {
      id: fileId,
      mimeType: f.mimeType,
      modifiedTime: f.modifiedTime,
      revision: String(f.version),
      size: f.text !== undefined ? new TextEncoder().encode(f.text).length : (f.bytes?.length ?? 0),
      trashed: f.trashed,
    };
  }

  async getMeta(fileId: string): Promise<DriveFileMeta> {
    this.maybeFail('meta', fileId);
    return this.meta(fileId);
  }

  async readText(fileId: string): Promise<{ text: string; meta: DriveFileMeta }> {
    this.maybeFail('read', fileId);
    const meta = this.meta(fileId);
    const f = this.files.get(fileId)!;
    if (f.text === undefined) throw new AppError('VALIDATION_FAILED', { provider: 'drive', reason: 'not_text' });
    return { text: f.text, meta };
  }

  async writeText(fileId: string, text: string, expectedRevision: string): Promise<DriveFileMeta> {
    const before = this.meta(fileId);
    if (before.revision !== expectedRevision) throw new AppError('STALE_READ', { provider: 'drive' });
    this.beforeWrite?.(fileId);
    this.maybeFail('write', fileId);
    const f = this.files.get(fileId)!;
    this.files.set(fileId, { ...f, text, version: f.version + 1, modifiedTime: this.tick() });
    this.writes.push({ fileId, text });
    return this.meta(fileId);
  }

  async createFile(input: DriveCreateInput): Promise<DriveFileMeta & { webLink: string }> {
    if (!DRIVE_FILE_NAME.test(input.name)) throw new AppError('VALIDATION_FAILED', { provider: 'drive', reason: 'file_name' });
    if (input.bytes.length === 0 || input.bytes.length > DRIVE_CREATE_MAX_BYTES) throw new AppError('VALIDATION_FAILED', { provider: 'drive', reason: 'size' });
    this.maybeFail('write', input.name);
    this.createdCount += 1;
    const stem = input.name.replace(/\.[A-Za-z0-9]+$/, '').replace(/[^A-Za-z0-9_-]/g, '_');
    const id = `SYNTH_asset_${stem}_${this.createdCount}`;
    this.files.set(id, { bytes: input.bytes.slice(), mimeType: input.mimeType, version: 1, modifiedTime: this.tick(), trashed: false });
    this.created.push({ id, name: input.name, mimeType: input.mimeType, ...(input.folderId ? { folderId: input.folderId } : {}) });
    return { ...this.meta(id), webLink: `https://drive.google.com/file/d/${id}/view` };
  }

  bytesOf(fileId: string): Uint8Array | undefined {
    return this.files.get(fileId)?.bytes;
  }

  /** Replace a binary file's bytes as if someone edited it in Drive. */
  externalReplaceBytes(fileId: string, bytes: Uint8Array): void {
    const f = this.files.get(fileId)!;
    this.files.set(fileId, { ...f, bytes, version: f.version + 1, modifiedTime: this.tick() });
  }

  async readBytes(fileId: string, maxBytes: number): Promise<{ bytes: Uint8Array; meta: DriveFileMeta }> {
    this.maybeFail('read', fileId);
    const meta = this.meta(fileId);
    if (meta.size > maxBytes) throw new AppError('VALIDATION_FAILED', { provider: 'drive', reason: 'too_large' });
    const f = this.files.get(fileId)!;
    return { bytes: f.bytes ?? new TextEncoder().encode(f.text ?? ''), meta };
  }
}
