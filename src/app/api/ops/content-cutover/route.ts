import 'server-only';
import { z } from 'zod';
import { getServices } from '@/application/container';
import { requireCutoverActor } from '@/lib/cutover-auth';
import { serverEnv } from '@/lib/env';
import { errorResponse, json } from '@/lib/http';
import { AppError } from '@/domain/errors';
import { readCutoverStatus, readOwnerCutoverStatus } from '@/application/cutover-status';
import { assertExpectedCutoverBuild, expectedBuildSchema } from '@/application/cutover-build';
import { timed } from '@/observability/events';
import { ownerCutoverResult } from '@/application/cutover-result';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
/** Read-only, build-bound admission; no caller payload or operation identity. */
export async function GET(request: Request) {
  try {
    const env = serverEnv();
    const actor = await requireCutoverActor(request, env.CRON_SECRET);
    if (new URL(request.url).search || request.headers.has('Content-Type') || request.body !== null) throw new AppError('VALIDATION_FAILED');
    // Keep the runner's response and provider reads identical. Only the owner
    // panel needs an import countdown; failure is unknown, never a green age.
    return json({ ok: true, status: actor === 'cron_bearer' ? await readCutoverStatus(env) : await readOwnerCutoverStatus(env) });
  } catch (error) { return errorResponse(error); }
}

// Explicit handlers keep private cache headers on method refusals too.
const methodNotAllowed = () => json({ ok: false, code: 'METHOD_NOT_ALLOWED' }, { status: 405 });
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
export const HEAD = methodNotAllowed;
export const OPTIONS = methodNotAllowed;
const activation = z.object({
  action: z.enum(['activate-read', 'activate-db']),
  expectedBuild: expectedBuildSchema,
}).strict();
const operation = z.union([activation, z.object({ action: z.enum(['measure', 'backup', 'rollback', 'export']) }).strict()]);
/** Private coordinator operations; activation is bound to the reviewed build. */
export async function POST(request: Request) {
  try {
    const env = serverEnv();
    const actor = await requireCutoverActor(request, env.CRON_SECRET);
    const body: unknown = await request.json();
    const parsed = operation.safeParse(body);
    if (!parsed.success) {
      const action = body && typeof body === 'object' && 'action' in body ? body.action : undefined;
      if (action === 'activate-read' || action === 'activate-db') throw new AppError('GATE_BLOCKED', { reason: 'cutover_expected_build_invalid' });
      throw new AppError('VALIDATION_FAILED');
    }
    const operationId = z.string().uuid().safeParse(request.headers.get('Idempotency-Key'));
    if (!operationId.success) throw new AppError('VALIDATION_FAILED');
    // Read once, before service composition, leases, replay or activation. Pass
    // this same snapshot through to the store that supplies SQL's p_build.
    const build = env.VERCEL_GIT_COMMIT_SHA ?? env.CS_COMMIT_SHA ?? '';
    if ('expectedBuild' in parsed.data) assertExpectedCutoverBuild(parsed.data.expectedBuild, build);
    const ops = getServices().liveCutover;
    if (!ops) throw new AppError('FORBIDDEN');
    const result = await timed({ name: 'cutover.operation', adapter: 'app', operationId: operationId.data,
      facts: { action: parsed.data.action, actor } }, () => ops.execute(parsed.data.action, operationId.data, build, actor));
    return json({ ok: true, result: actor === 'cron_bearer' ? result : ownerCutoverResult(parsed.data.action, result, build) });
  } catch (error) { return errorResponse(error); }
}
