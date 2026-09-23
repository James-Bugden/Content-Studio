import 'server-only';
import { z } from 'zod';
import { getServices, type Services } from '@/application/container';
import { clientResult } from '@/application/typefully-view';
import { AppError } from '@/domain/errors';
import { contentIdSchema, operationIdSchema, revisionSchema, type Actor, type MutationResult } from '@/domain/mutation';
import type { ScheduleRecord } from '@/domain/records';
import { requireMutation } from '@/lib/auth';
import { errorResponse, resultResponse } from '@/lib/http';

/**
 * Shared plumbing for the Typefully mutation routes (CS-015/016): same-origin
 * owner session, a validated Content ID and zod body, one service call, and a
 * client-safe result (never the provider's draft objects).
 */
export const baseBody = z.object({ operationId: operationIdSchema, expectedRevision: revisionSchema });

type ServiceResult = MutationResult<{ record: ScheduleRecord; supplied?: string[]; unavailable?: string[] }>;

export async function typefullyMutation<S extends z.ZodType>(
  request: Request,
  ctx: { params: Promise<{ contentId: string }> },
  schema: S,
  run: (args: { services: Services; actor: Actor; contentId: string; body: z.infer<S> }) => Promise<ServiceResult>,
) {
  try {
    const actor = await requireMutation(request);
    const { contentId } = await ctx.params;
    if (!contentIdSchema.safeParse(contentId).success) throw new AppError('VALIDATION_FAILED');
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AppError('VALIDATION_FAILED');
    const result = clientResult(await run({ services: getServices(), actor, contentId, body: parsed.data }));
    return resultResponse(result);
  } catch (error) {
    return errorResponse(error);
  }
}
