import { ownerRoute } from '@/replies/lib/server/owner-route';
import { jsonResponse, readJson } from '@/replies/lib/server/http';
import { getStore } from '@/replies/lib/server/get-store';
import { librarySearchRequestSchema } from '@/replies/lib/contracts/api';

export const dynamic = 'force-dynamic';

/**
 * POST /api/library/search (D14, SEC-05).
 *
 * A POST for a read, which looks wrong until you consider where a query string
 * ends up: browser history, the referrer header, and every access log between here
 * and the database. The search text here is the owner's private writing, so it
 * travels in a body that none of those record.
 */
export const POST = ownerRoute(async (request, { session }) => {
  const body = await readJson(request, librarySearchRequestSchema);
  const store = getStore(session);

  const result = await store.searchLibrary({
    query: body.query,
    ...(body.platforms ? { platforms: body.platforms } : {}),
    ...(body.provenances ? { provenances: body.provenances } : {}),
    includeUnknownDates: body.include_unknown_dates,
    cursor: body.cursor ?? null,
    limit: body.limit,
  });

  return jsonResponse({
    state: result.state,
    items: result.items,
    next_cursor: result.nextCursor,
  });
});

