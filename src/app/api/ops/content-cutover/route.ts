import 'server-only';
import { z } from 'zod';
import { getServices } from '@/application/container';
import { requireCronSecret } from '@/lib/cron-auth';
import { serverEnv } from '@/lib/env';
import { errorResponse, json } from '@/lib/http';
import { AppError } from '@/domain/errors';
import { readCutoverStatus } from '@/application/cutover-status';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
/** Read-only, build-bound admission; no caller payload or operation identity. */
export async function GET(request: Request) {
  try {
    const env = serverEnv();
    requireCronSecret(request, env.CRON_SECRET);
    if (new URL(request.url).search || request.headers.has('Content-Type') || request.body !== null) throw new AppError('VALIDATION_FAILED');
    return json({ ok: true, status: await readCutoverStatus(env) });
  } catch (error) { return errorResponse(error); }
}

// Explicit handlers keep private cache headers on method refusals too.
const methodNotAllowed = () => json({ ok: false, code: 'METHOD_NOT_ALLOWED' }, { status: 405 });
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
export const HEAD = methodNotAllowed;
export const OPTIONS = methodNotAllowed;
/** Private coordinator operations; no caller-supplied credentials or payloads. */
export async function POST(request: Request) {
  try {
    requireCronSecret(request, serverEnv().CRON_SECRET);
    const parsed = z.object({ action: z.enum(['measure', 'backup', 'rollback', 'activate-read', 'activate-db']) }).strict().safeParse(await request.json());
    const operationId = z.string().uuid().safeParse(request.headers.get('Idempotency-Key'));
    if (!parsed.success || !operationId.success) throw new AppError('VALIDATION_FAILED');
    const ops = getServices().liveCutover;
    if (!ops) throw new AppError('FORBIDDEN');
    return json({ ok: true, result: await ops.execute(parsed.data.action, operationId.data) });
  } catch (error) { return errorResponse(error); }
}
