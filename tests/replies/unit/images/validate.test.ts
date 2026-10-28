import { describe, expect, it } from 'vitest';
import {
  BANK_IMAGE_MAX_BYTES,
  fileExtension,
  sniffBankImage,
  validateBankUpload,
} from '@/replies/lib/images/validate';

const png = (size = 16) => {
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return bytes;
};
const jpeg = (size = 16) => {
  const bytes = new Uint8Array(size);
  bytes.set([0xff, 0xd8, 0xff, 0xe0]);
  return bytes;
};
const webp = (size = 16) => {
  const bytes = new Uint8Array(size);
  bytes.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  return bytes;
};
const gif = () => new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0]);
const svg = () => new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

describe('bank upload validation (#245)', () => {
  it.each([
    ['PNG', png(), 'image/png'],
    ['JPEG', jpeg(), 'image/jpeg'],
    ['WebP', webp(), 'image/webp'],
  ])('accepts a real %s by its magic bytes', (_name, bytes, mime) => {
    expect(validateBankUpload({ bytes, declaredType: mime })).toEqual({ ok: true, mime });
  });

  it('decides by the bytes, not the label: a PNG sent as image/jpeg is refused', () => {
    expect(validateBankUpload({ bytes: png(), declaredType: 'image/jpeg' })).toEqual({ ok: false, reason: 'type_mismatch' });
  });

  it('accepts a missing or generic declared type when the bytes are an allowed image', () => {
    expect(validateBankUpload({ bytes: png() })).toEqual({ ok: true, mime: 'image/png' });
    expect(validateBankUpload({ bytes: png(), declaredType: '' })).toEqual({ ok: true, mime: 'image/png' });
    expect(validateBankUpload({ bytes: png(), declaredType: 'application/octet-stream' })).toEqual({ ok: true, mime: 'image/png' });
    expect(validateBankUpload({ bytes: png(), declaredType: 'IMAGE/PNG; charset=binary' })).toEqual({ ok: true, mime: 'image/png' });
  });

  it('refuses SVG, GIF, text and anything else, whatever it claims to be', () => {
    expect(validateBankUpload({ bytes: svg(), declaredType: 'image/png' })).toEqual({ ok: false, reason: 'unsupported_type' });
    expect(validateBankUpload({ bytes: svg(), declaredType: 'image/svg+xml' })).toEqual({ ok: false, reason: 'unsupported_type' });
    expect(validateBankUpload({ bytes: gif(), declaredType: 'image/gif' })).toEqual({ ok: false, reason: 'unsupported_type' });
    expect(validateBankUpload({ bytes: new TextEncoder().encode('hello'), declaredType: 'image/png' })).toEqual({
      ok: false,
      reason: 'unsupported_type',
    });
  });

  it('refuses an empty file', () => {
    expect(validateBankUpload({ bytes: new Uint8Array(0), declaredType: 'image/png' })).toEqual({ ok: false, reason: 'empty' });
  });

  it('enforces the 5 MB limit exactly', () => {
    expect(validateBankUpload({ bytes: png(BANK_IMAGE_MAX_BYTES) }).ok).toBe(true);
    expect(validateBankUpload({ bytes: png(BANK_IMAGE_MAX_BYTES + 1) })).toEqual({ ok: false, reason: 'too_large' });
  });

  it('reports a size problem before a type problem, so a huge wrong file is not parsed', () => {
    const huge = new Uint8Array(BANK_IMAGE_MAX_BYTES + 10);
    expect(validateBankUpload({ bytes: huge })).toEqual({ ok: false, reason: 'too_large' });
  });

  it('sniffs only the three allowed types', () => {
    expect(sniffBankImage(png())).toBe('image/png');
    expect(sniffBankImage(jpeg())).toBe('image/jpeg');
    expect(sniffBankImage(webp())).toBe('image/webp');
    expect(sniffBankImage(gif())).toBeNull();
    expect(fileExtension('image/jpeg')).toBe('jpg');
  });
});
