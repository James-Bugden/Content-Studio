import type { NextRequest } from 'next/server';
import { ownerRoute } from '@/replies/lib/server/owner-route';
import { jsonResponse, readJson } from '@/replies/lib/server/http';
import { getStore } from '@/replies/lib/server/get-store';
import { AppError } from '@/replies/lib/contracts/errors';
import { bankImageDeleteSchema, bankImageUpdateSchema } from '@/replies/lib/contracts/api';
import { normaliseTags } from '@/replies/lib/images/tags';

export const dynamic = 'force-dynamic';

/**
 * PATCH/DELETE /api/replies/images/:id (#245).
 *
 * Both carry the version the form was loaded with, so a stale form cannot overwrite
 * or delete a newer edit, and a request key, so a repeated press is a replay.
 * Delete is a real delete: the bytes go with the row. The audit record stays.
 */

function idFromPath(request: NextRequest): string {
  const segments = request.nextUrl.pathname.split('/').filter(Boolean);
  const id = segments[segments.length - 1];
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) throw new AppError('validation_failed', 'That request was not valid.');
  return id;
}

export const PATCH = ownerRoute(async (request, { session }) => {
  const id = idFromPath(request);
  const body = await readJson(request, bankImageUpdateSchema);
  const store = getStore(session);

  // Only the keys the caller sent are written; an absent key stays as it is.
  const changes: Record<string, unknown> = { ...body.changes };
  if (body.changes.tags) changes.tags = normaliseTags(body.changes.tags, 20);

  const result = await store.updateBankImage({
    id,
    expectedVersion: body.expected_version,
    requestKey: body.request_key,
    action: 'update',
    changes,
  });
  return jsonResponse(result);
});

export const DELETE = ownerRoute(async (request, { session }) => {
  const id = idFromPath(request);
  const body = await readJson(request, bankImageDeleteSchema);
  const store = getStore(session);
  await store.deleteBankImage({ id, expectedVersion: body.expected_version, requestKey: body.request_key });
  return jsonResponse({ ok: true });
});
