import { sniffImage } from '@/domain/links';

/**
 * Upload validation for the image bank (#245).
 *
 * The declared type is only a claim. The bytes decide: a file is accepted when its
 * magic bytes say PNG, JPEG or WebP, and when the declared type (if any) agrees.
 * SVG and GIF are refused: SVG can carry script, and the bank is for stills.
 */

export const BANK_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const BANK_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type BankImageType = (typeof BANK_IMAGE_TYPES)[number];

export type UploadVerdict =
  | { ok: true; mime: BankImageType }
  | { ok: false; reason: 'empty' | 'too_large' | 'unsupported_type' | 'type_mismatch' };

export function sniffBankImage(bytes: Uint8Array): BankImageType | null {
  const sniffed = sniffImage(bytes);
  return sniffed && (BANK_IMAGE_TYPES as readonly string[]).includes(sniffed) ? (sniffed as BankImageType) : null;
}

export function validateBankUpload(input: { bytes: Uint8Array; declaredType?: string | null }): UploadVerdict {
  if (input.bytes.length === 0) return { ok: false, reason: 'empty' };
  if (input.bytes.length > BANK_IMAGE_MAX_BYTES) return { ok: false, reason: 'too_large' };
  const mime = sniffBankImage(input.bytes);
  if (!mime) return { ok: false, reason: 'unsupported_type' };
  const declared = (input.declaredType ?? '').split(';')[0]!.trim().toLowerCase();
  if (declared && declared !== 'application/octet-stream' && declared !== mime) {
    return { ok: false, reason: 'type_mismatch' };
  }
  return { ok: true, mime };
}

/** Words for a person, one per refusal. Never echoes the file name or contents. */
export const UPLOAD_REFUSAL: Readonly<Record<Extract<UploadVerdict, { ok: false }>['reason'], string>> = Object.freeze({
  empty: 'That file is empty.',
  too_large: 'That image is over 5 MB.',
  unsupported_type: 'Use a PNG, JPG or WebP image.',
  type_mismatch: 'That file is not the type it says it is.',
});

export function fileExtension(mime: BankImageType): string {
  return mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpg' : 'webp';
}
