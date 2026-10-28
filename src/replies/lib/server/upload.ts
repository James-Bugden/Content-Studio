import 'server-only';
import { createHash } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { AppError } from '@/replies/lib/contracts/errors';
import { BANK_IMAGE_LIMITS, requestKeySchema } from '@/replies/lib/contracts/api';
import { parseTagInput } from '@/replies/lib/images/tags';
import { UPLOAD_REFUSAL, validateBankUpload, type BankImageType } from '@/replies/lib/images/validate';

/**
 * Reads one image upload for the bank (#245).
 *
 * The body is multipart, because base64 inside JSON would not fit the JSON body
 * limit and would inflate a 5 MB image by a third. Everything is checked before
 * anything is stored, in this order: declared size, real size, magic bytes, then
 * the text fields. The browser's claim about the type is only ever compared with
 * what the bytes say; the bytes decide.
 */

/** Room for the form's own text fields around a maximum-size image. */
const MULTIPART_SLACK_BYTES = 64 * 1024;

const fieldsSchema = z.object({
  request_key: requestKeySchema,
  title: z.string().trim().min(1, 'Add a title.').max(200),
  alt_text: z.string().trim().max(500).default(''),
  tags: z.string().max(2000).default(''),
});

export interface ImageUpload {
  requestKey: string;
  title: string;
  altText: string;
  tags: string[];
  bytes: Uint8Array;
  mime: BankImageType;
  sha256: string;
}

function text(form: FormData, name: string): string | undefined {
  const value = form.get(name);
  return typeof value === 'string' ? value : undefined;
}

export async function readImageUpload(request: NextRequest): Promise<ImageUpload> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > BANK_IMAGE_LIMITS.maxBytes + MULTIPART_SLACK_BYTES) {
    throw new AppError('payload_too_large', UPLOAD_REFUSAL.too_large);
  }
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('multipart/form-data')) {
    throw new AppError('validation_failed', 'Choose an image to upload.');
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new AppError('validation_failed', 'That upload was not valid.');
  }

  const file = form.get('file');
  if (!(file instanceof File)) throw new AppError('validation_failed', 'Choose an image to upload.');
  if (file.size > BANK_IMAGE_LIMITS.maxBytes) {
    throw new AppError('payload_too_large', UPLOAD_REFUSAL.too_large);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const verdict = validateBankUpload({ bytes, declaredType: file.type });
  if (!verdict.ok) {
    throw new AppError(
      verdict.reason === 'too_large' ? 'payload_too_large' : 'validation_failed',
      UPLOAD_REFUSAL[verdict.reason],
    );
  }

  const parsed = fieldsSchema.safeParse({
    request_key: text(form, 'request_key'),
    title: text(form, 'title'),
    alt_text: text(form, 'alt_text') ?? '',
    tags: text(form, 'tags') ?? '',
  });
  if (!parsed.success) {
    throw new AppError('validation_failed', parsed.error.issues[0]?.message ?? 'That upload was not valid.');
  }

  return {
    requestKey: parsed.data.request_key,
    title: parsed.data.title,
    altText: parsed.data.alt_text,
    tags: parseTagInput(parsed.data.tags),
    bytes,
    mime: verdict.mime,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}
