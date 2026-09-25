import { runConfiguredSheetMirror } from '@/lib/sheet-mirror-operation';
import { requireCronSecret } from '@/lib/cron-auth';
import { serverEnv } from '@/lib/env';
import { errorResponse, json } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Scheduler hook for complete Sheet-first reconciliation. Vercel Cron sends a
 * GET with `Authorization: Bearer <CRON_SECRET>`. No schedule is registered
 * until copied-data proof and the dedicated project are ready.
 */
export async function GET(request: Request) {
  try {
    requireCronSecret(request, serverEnv().CRON_SECRET);
    return json({ ok: true, ...(await runConfiguredSheetMirror()) });
  } catch (error) {
    return errorResponse(error);
  }
}
