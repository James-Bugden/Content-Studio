import { ownerRoute } from '@/replies/lib/server/owner-route';
import { jsonResponse, readJson } from '@/replies/lib/server/http';
import { getStore } from '@/replies/lib/server/get-store';
import { factInputSchema } from '@/replies/lib/contracts/api';

export const dynamic = 'force-dynamic';

/**
 * GET/POST /api/facts (C06, D14).
 *
 * `approved` is forced to `false` on every create here, regardless of what the
 * request body says. `factInputSchema` already defaults it to `false`, but a
 * default is something a caller can override; this override is not. Importing or
 * pasting in an anecdote must never grant it eligibility as a side effect of
 * saving it.
 */

export const GET = ownerRoute(async (_request, { session }) => {
  const store = getStore(session);
  const facts = await store.listFacts();
  return jsonResponse({ facts });
});

export const POST = ownerRoute(async (request, { session }) => {
  const body = await readJson(request, factInputSchema);
  const store = getStore(session);
  const result = await store.saveFact({ id: null, expectedVersion: null, fields: { ...body, approved: false } });
  return jsonResponse(result);
});

