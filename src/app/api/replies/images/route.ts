import { createHash } from 'node:crypto';
import { ownerRoute } from '@/replies/lib/server/owner-route';
import { jsonResponse } from '@/replies/lib/server/http';
import { getStore } from '@/replies/lib/server/get-store';
import { readImageUpload } from '@/replies/lib/server/upload';
import { toBankImage } from '@/replies/lib/images/bank-image';

export const dynamic = 'force-dynamic';

/**
 * GET/POST /api/replies/images (#245).
 *
 * List and upload for the image bank. The list never carries bytes: each entry has
 * a same-origin URL to the owner-checked file route, so the browser fetches pixels
 * only for what it shows.
 *
 * Upload is owner-only and same-origin (both enforced before the body is read), is
 * validated by magic bytes and size, and carries a request key so a repeated press
 * of Save returns the image already made instead of adding a second.
 */

export const GET = ownerRoute(async (_request, { session }) => {
  const store = getStore(session);
  const rows = await store.listBankImages();
  return jsonResponse({ images: rows.map(toBankImage) });
});

export const POST = ownerRoute(async (request, { session }) => {
  const upload = await readImageUpload(request);
  const store = getStore(session);

  // The same key with the same details replays; the same key with different
  // details is refused rather than quietly overwriting.
  const requestHash = createHash('sha256')
    .update(JSON.stringify([upload.title, upload.altText, upload.tags, upload.sha256]))
    .digest('hex');

  const result = await store.createBankImage({
    requestKey: upload.requestKey,
    requestHash,
    title: upload.title,
    altText: upload.altText,
    tags: upload.tags,
    origin: 'upload',
    status: 'ready',
    sketch: '',
    brief: '',
    file: { bytes: upload.bytes, mime: upload.mime, sha256: upload.sha256 },
  });
  return jsonResponse(result);
});
