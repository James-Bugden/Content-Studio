import { requireMutation } from '@/lib/auth';
import { requireCronSecret } from '@/lib/cron-auth';
import { serverEnv } from '@/lib/env';
import { errorResponse, json } from '@/lib/http';
import { cronBackupId, manualBackupId, runConfiguredBackup } from '@/lib/weekly-backup';
import type { WeeklyBackupResult } from '@/application/weekly-backup';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Response body: counts and names only, never row content. */
function respond(result: WeeklyBackupResult) {
  if (result.status === 'failure') return json({ ok: false, status: 'failure', errorMessage: result.errorMessage }, { status: 502 });
  if (result.status === 'busy') return json({ ok: true, status: 'busy' }, { status: 202 });
  const run = result.run;
  return json({ ok: true, status: result.status, fileName: run.fileName, sizeBytes: run.sizeBytes, rowCounts: run.rowCounts, runStatus: run.status });
}

/** Vercel Cron (weekly). Fails closed when CRON_SECRET is unset or the bearer is wrong. */
export async function GET(request: Request) {
  try {
    requireCronSecret(request, serverEnv().CRON_SECRET);
    return respond(await runConfiguredBackup('cron', cronBackupId()));
  } catch (error) { return errorResponse(error); }
}

/** Owner's "Back up now": same-origin, owner session, and a client UUID idempotency key. */
export async function POST(request: Request) {
  try {
    await requireMutation(request);
    const id = manualBackupId(request.headers.get('Idempotency-Key'));
    return respond(await runConfiguredBackup('manual', id));
  } catch (error) { return errorResponse(error); }
}
