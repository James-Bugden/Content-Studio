import type { NextRequest } from 'next/server';
import { ownerRoute } from '@/replies/lib/server/owner-route';
import { jsonResponse, readJson } from '@/replies/lib/server/http';
import { getStore } from '@/replies/lib/server/get-store';
import { AppError } from '@/replies/lib/contracts/errors';
import { resourceUpdateSchema } from '@/replies/lib/contracts/api';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/resources/:id (D06, D14, C07).
 *
 * `expected_version` is required on every call. A stale value is a 409, mapped by
 * `store.saveResource` itself, so a save made from a form that has been sitting
 * open while someone else edited the same resource cannot silently clobber the
 * newer edit; the caller sees a conflict and keeps what it typed.
 *
 * Disabling a resource is an ordinary call here with `changes: { active: false }`.
 * There is no separate delete endpoint (D06).
 */

function idFromPath(request: NextRequest): string {
  const segments = request.nextUrl.pathname.split('/').filter(Boolean);
  const id = segments[segments.length - 1];
  if (!id) throw new AppError('validation_failed', 'That request was not valid.');
  return id;
}

export const PATCH = ownerRoute(async (request, { session }) => {
  const id = idFromPath(request);
  const body = await readJson(request, resourceUpdateSchema);
  const store = getStore(session);
  const result = await store.saveResource({ id, expectedVersion: body.expected_version, fields: body.changes });
  return jsonResponse(result);
});

