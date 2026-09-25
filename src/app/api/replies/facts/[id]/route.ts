import type { NextRequest } from 'next/server';
import { ownerRoute } from '@/replies/lib/server/owner-route';
import { jsonResponse, readJson } from '@/replies/lib/server/http';
import { getStore } from '@/replies/lib/server/get-store';
import { AppError } from '@/replies/lib/contracts/errors';
import { factUpdateSchema } from '@/replies/lib/contracts/api';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/facts/:id (C06, D14, C07).
 *
 * Approval happens only here, as an explicit edit to an already-created fact, and
 * only after the owner has read the fact back. `expected_version` guards this the
 * same way it guards a resource: a stale save is a 409, not a silent overwrite.
 */

function idFromPath(request: NextRequest): string {
  const segments = request.nextUrl.pathname.split('/').filter(Boolean);
  const id = segments[segments.length - 1];
  if (!id) throw new AppError('validation_failed', 'That request was not valid.');
  return id;
}

export const PATCH = ownerRoute(async (request, { session }) => {
  const id = idFromPath(request);
  const body = await readJson(request, factUpdateSchema);
  const store = getStore(session);
  const result = await store.saveFact({ id, expectedVersion: body.expected_version, fields: body.changes });
  return jsonResponse(result);
});

