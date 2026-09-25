import { ownerRoute } from '@/replies/lib/server/owner-route';
import { jsonResponse, readJson } from '@/replies/lib/server/http';
import { getStore } from '@/replies/lib/server/get-store';
import { settingsSchema } from '@/replies/lib/contracts/api';

export const dynamic = 'force-dynamic';

/**
 * GET/PATCH /api/settings (C10, D14).
 *
 * Daily targets and timezone only. Configuration status is read straight from
 * `configurationStatus()` on the settings page itself rather than served here,
 * because that function already returns names and states and nothing this route
 * could add to it is worth a second endpoint to leak from.
 */

export const GET = ownerRoute(async (_request, { session }) => {
  const store = getStore(session);
  const settings = await store.getSettings();
  return jsonResponse(settings);
});

export const PATCH = ownerRoute(async (request, { session }) => {
  const body = await readJson(request, settingsSchema);
  const store = getStore(session);
  const settings = await store.saveSettings(body);
  return jsonResponse(settings);
});

