import { requireCronSecret } from '@/lib/cron-auth';
import { serverEnv } from '@/lib/env';
import { repairContentExport } from '@/lib/content-maintenance';
import { errorResponse, json } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
/** Owner-configured 15-minute repair. No live schedule is installed here. */
export async function GET(request: Request) {
  try {
    requireCronSecret(request, serverEnv().CRON_SECRET);
    return json({ ok: true, ...(await repairContentExport()) });
  } catch (error) { return errorResponse(error); }
}
