import 'server-only';
import { AppError } from '@/domain/errors';
import { PREVIEW_MAX_BYTES, PREVIEW_MIME, parseDriveFileId, sniffImage } from '@/domain/links';
import type { DriveGateway } from './ports';

/**
 * Server-mediated image previews (CS-004 VIS-01). The browser never receives a
 * Drive URL, bearer token or stable private download link: the app streams the
 * bytes itself after checking the declared type, the actual magic bytes and size.
 * SVG and anything else are refused.
 */
export async function previewAsset(drive: DriveGateway, fileRef: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  const fileId = parseDriveFileId(fileRef) ?? (/^SYNTH_[A-Za-z0-9_.-]{3,120}$/.test(fileRef) ? fileRef : null);
  if (!fileId) throw new AppError('VALIDATION_FAILED', { reason: 'asset_ref' });
  const { bytes, meta } = await drive.readBytes(fileId, PREVIEW_MAX_BYTES);
  if (!PREVIEW_MIME.has(meta.mimeType)) throw new AppError('VALIDATION_FAILED', { reason: 'unsupported_type' });
  const sniffed = sniffImage(bytes);
  if (!sniffed || sniffed !== meta.mimeType) throw new AppError('VALIDATION_FAILED', { reason: 'type_mismatch' });
  return { bytes, contentType: sniffed };
}
