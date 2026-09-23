/**
 * Drive link resolution (CS-004, SEC-04). Only Google Drive/Docs URLs on known
 * hosts, or a bare file id, resolve to a file id. Anything else (other hosts,
 * javascript:, relative paths) is refused, so a cell cannot steer the server to an
 * arbitrary URL.
 */
const HOSTS = new Set(['drive.google.com', 'docs.google.com']);
/** Bare ids must look like Drive ids (real ones are 28-44 chars) so a plain word never resolves. */
const ID = /^[A-Za-z0-9_-]{20,200}$/;

export function parseDriveFileId(input: string): string | null {
  const text = input.trim();
  if (text === '') return null;
  if (ID.test(text)) return text;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !HOSTS.has(url.hostname)) return null;
  const path = /\/d\/([A-Za-z0-9_-]{10,200})(?:\/|$)/.exec(url.pathname);
  if (path) return path[1]!;
  const q = url.searchParams.get('id');
  return q && ID.test(q) ? q : null;
}

/** Only these image types are previewed. SVG is excluded: it can carry script. */
export const PREVIEW_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
export const PREVIEW_MAX_BYTES = 8 * 1024 * 1024;

/** Magic-byte sniff so a mislabelled file cannot be served as an image. */
export function sniffImage(bytes: Uint8Array): string | null {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  return null;
}
