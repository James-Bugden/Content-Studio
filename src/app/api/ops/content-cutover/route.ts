import 'server-only';
import { z } from 'zod';
import { getServices } from '@/application/container';
import { requireCronSecret } from '@/lib/cron-auth';
import { serverEnv } from '@/lib/env';
import { errorResponse, json } from '@/lib/http';
import { AppError } from '@/domain/errors';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
/** Private coordinator operations; no caller-supplied credentials or payloads. */
export async function POST(request: Request) {
  try {
    requireCronSecret(request, serverEnv().CRON_SECRET);
    const parsed = z.object({ action: z.enum(['measure', 'backup', 'rollback']) }).strict().safeParse(await request.json());
    const operationId = z.string().uuid().safeParse(request.headers.get('Idempotency-Key'));
    if (!parsed.success || !operationId.success) throw new AppError('VALIDATION_FAILED');
    const ops = getServices().liveCutover;
    if (!ops) throw new AppError('FORBIDDEN');
    return json({ ok: true, result: await ops.execute(parsed.data.action, operationId.data) });
  } catch (error) { return errorResponse(error); }
}
