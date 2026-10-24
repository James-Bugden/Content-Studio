import { requireCronSecret } from '@/lib/cron-auth';
import { serverEnv } from '@/lib/env';
import { scheduledContentBackup } from '@/lib/content-maintenance';
import { errorResponse, json } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
/** Owner-configured daily at 19:00 UTC (03:00 Taipei). */
export async function GET(request: Request) {
  try {
    requireCronSecret(request, serverEnv().CRON_SECRET);
    return json({ ok: true, ...(await scheduledContentBackup()) });
  } catch (error) { return errorResponse(error); }
}
