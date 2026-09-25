import { ownerRoute } from '@/replies/lib/server/owner-route';
import { jsonResponse } from '@/replies/lib/server/http';
import { getStore } from '@/replies/lib/server/get-store';
import { publicConfig } from '@/replies/lib/config/env';
import { progressSchema } from '@/replies/lib/contracts/api';

export const dynamic = 'force-dynamic';

/**
 * GET /api/progress (C07, DAY-01).
 *
 * Counts and targets, and nothing else. This is the one endpoint polled on every
 * window focus, so a body carrying reply text would put the owner's writing into
 * far more request logs than a save ever does.
 *
 * The local day is computed on the server from the configured timezone, so a
 * browser in another timezone still sees the Taipei day the counter uses.
 */
export const GET = ownerRoute(async (_request, { session }) => {
  const store = getStore(session);
  const progress = await store.dailyCounts(publicConfig().timezone);
  return jsonResponse(progressSchema.parse(progress));
});

