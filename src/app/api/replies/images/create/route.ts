import { createHash } from 'node:crypto';
import { ownerRoute } from '@/replies/lib/server/owner-route';
import { jsonResponse, readJson } from '@/replies/lib/server/http';
import { getStore } from '@/replies/lib/server/get-store';
import { once } from '@/replies/lib/server/ai-memo';
import { AppError } from '@/replies/lib/contracts/errors';
import { bankImageCreateSchema } from '@/replies/lib/contracts/api';
import { sketchStamp, toBankImage } from '@/replies/lib/images/bank-image';
import { BANK_IMAGE_MAX_BYTES, sniffBankImage } from '@/replies/lib/images/validate';
import { getServices } from '@/application/container';
import { renderBankImage, sketchBankImage } from '@/application/bank-images';
import { getImageRenderer } from '@/integrations/image-renderer/container';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * POST /api/replies/images/create (#245): "Create new" for a bank image.
 *
 * The same pipeline a Content Library post uses, in the same order and with the
 * same tasks: an ASCII sketch the owner can revise, an explicit approval of that
 * exact sketch, and only then the editorial image. The finished PNG is saved to the
 * bank. Every step that calls a model goes through the AI gateway, so each is
 * counted in the monthly cap and refused at it.
 *
 *   sketch   makes a new bank entry in "sketch" state (one AI call)
 *   revise   replaces the sketch from a note and withdraws any approval (one AI call)
 *   approve  records approval of the current sketch text (no AI)
 *   create   renders the approved sketch and attaches the PNG (AI call + renderer)
 *
 * Retries are safe: each step carries a request key, and a repeated key reuses the
 * first model call instead of making and billing another.
 */
export const POST = ownerRoute(async (request, { session }) => {
  const body = await readJson(request, bankImageCreateSchema);
  const store = getStore(session);
  const { ai } = getServices();
  const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

  if (body.action === 'sketch') {
    const sketch = await once(`sketch:${body.request_key}`, hash(body), () =>
      sketchBankImage(ai, { title: body.title, brief: body.brief, platform: body.platform }),
    );
    const created = await store.createBankImage({
      requestKey: body.request_key,
      requestHash: hash([body.title, body.brief, sketch.sketch]),
      title: body.title,
      altText: sketch.altText,
      tags: [],
      origin: 'created',
      status: 'sketch',
      sketch: sketch.sketch,
      brief: body.brief,
      file: null,
    });
    const row = await store.getBankImage(created.id);
    if (!row) throw new AppError('internal_error', 'Something went wrong.');
    return jsonResponse({ image: toBankImage(row) });
  }

  const row = await store.getBankImage(body.id);
  if (!row || row.origin !== 'created') throw new AppError('not_found', 'That is not available.');
  if (row.status === 'ready' && body.action === 'create') {
    // A retry after a lost response: the image was made. Say so rather than fail.
    return jsonResponse({ image: toBankImage(row) });
  }
  if (row.status !== 'sketch') {
    throw new AppError('validation_failed', 'That image is already made.');
  }

  if (body.action === 'revise') {
    const sketch = await once(`revise:${body.request_key}`, hash(body), () =>
      sketchBankImage(ai, {
        title: row.title,
        brief: `${row.brief}\n\nCurrent sketch:\n${row.sketch}`,
        platform: body.platform,
        note: body.note,
      }),
    );
    await store.updateBankImage({
      id: row.id,
      expectedVersion: body.expected_version,
      requestKey: body.request_key,
      action: 'update',
      // A revised sketch is a different sketch: any earlier approval no longer applies.
      changes: { sketch: sketch.sketch, alt_text: sketch.altText, sketch_approved_hash: null },
    });
  } else if (body.action === 'approve') {
    if (row.sketch === '') throw new AppError('validation_failed', 'There is no sketch to approve.');
    await store.updateBankImage({
      id: row.id,
      expectedVersion: body.expected_version,
      requestKey: body.request_key,
      action: 'approve',
      changes: { sketch_approved_hash: sketchStamp(row.sketch) },
    });
  } else {
    // Rendering needs the approval of THIS sketch text. A sketch edited after
    // approval has a different stamp, so a stale approval cannot spend a render.
    if (row.sketch_approved_hash !== sketchStamp(row.sketch)) {
      throw new AppError('validation_failed', 'Approve the current sketch before creating the image.');
    }
    if (row.version !== body.expected_version) {
      throw new AppError('version_conflict', 'This changed somewhere else. Reload before saving.');
    }
    const rendered = await once(`render:${body.request_key}`, hash(body), () =>
      renderBankImage(ai, getImageRenderer(), {
        title: row.title,
        brief: row.brief,
        sketch: row.sketch,
        platform: body.platform,
      }),
    );
    if (rendered.png.length > BANK_IMAGE_MAX_BYTES || sniffBankImage(rendered.png) !== 'image/png') {
      throw new AppError('provider_invalid_response', 'The image could not be created. Nothing was saved.');
    }
    await store.updateBankImage({
      id: row.id,
      expectedVersion: body.expected_version,
      requestKey: body.request_key,
      action: 'attach',
      changes: { alt_text: rendered.altText },
      file: { bytes: rendered.png, mime: 'image/png', sha256: rendered.sha256 },
    });
  }

  const updated = await store.getBankImage(row.id);
  if (!updated) throw new AppError('internal_error', 'Something went wrong.');
  return jsonResponse({ image: toBankImage(updated) });
});
