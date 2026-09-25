import { ownerRoute } from '@/replies/lib/server/owner-route';
import { jsonResponse, readJson } from '@/replies/lib/server/http';
import { getStore } from '@/replies/lib/server/get-store';
import { resourceInputSchema } from '@/replies/lib/contracts/api';

export const dynamic = 'force-dynamic';

/**
 * GET/POST /api/resources (D06, D14).
 *
 * List and create for the resource registry. There is no delete: `saveResource`
 * only ever inserts or updates a row, so a resource that a past reply already
 * links to stays resolvable even after it stops being offered in new ones.
 */

export const GET = ownerRoute(async (_request, { session }) => {
  const store = getStore(session);
  const resources = await store.listResources();
  return jsonResponse({ resources });
});

export const POST = ownerRoute(async (request, { session }) => {
  const body = await readJson(request, resourceInputSchema);
  const store = getStore(session);
  const result = await store.saveResource({ id: null, expectedVersion: null, fields: body });
  return jsonResponse(result);
});

