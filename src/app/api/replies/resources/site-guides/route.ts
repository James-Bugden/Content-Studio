import { ownerRoute } from '@/replies/lib/server/owner-route';
import { jsonResponse } from '@/replies/lib/server/http';
import { getStore } from '@/replies/lib/server/get-store';
import { resourceInputSchema } from '@/replies/lib/contracts/api';
import { SITE_GUIDES, missingSiteGuides, siteGuideFields } from '@/replies/lib/resources/site-guides';

export const dynamic = 'force-dynamic';

/**
 * POST /api/replies/resources/site-guides (CS-058).
 *
 * Adds one resource per site guide that is not in the registry yet, through the
 * same `saveResource` path and the same input schema as the Add form. Matching is
 * by English path, so running it twice adds nothing the second time and never
 * touches a resource that was already edited.
 */
export const POST = ownerRoute(async (_request, { session }) => {
  const store = getStore(session);
  const existing = await store.listResources();
  const missing = missingSiteGuides(existing);
  for (const guide of missing) {
    await store.saveResource({ id: null, expectedVersion: null, fields: resourceInputSchema.parse(siteGuideFields(guide)) });
  }
  return jsonResponse({ added: missing.length, already_there: SITE_GUIDES.length - missing.length });
});
