import { z } from 'zod';
import { getServices } from '@/application/container';
import { approveAdaptation } from '@/application/zh-tw';
import { AppError } from '@/domain/errors';
import { contentIdSchema, operationIdSchema, revisionSchema } from '@/domain/mutation';
import { requireMutation } from '@/lib/auth';
import { errorResponse, resultResponse } from '@/lib/http';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  operationId: operationIdSchema,
  threadsContentId: contentIdSchema,
  expectedRevision: revisionSchema,
});

/**
 * Explicit Chinese copy approval (CS-011 ZHTW-05). The service allows it only for
 * a fresh adaptation awaiting review; stale or ambiguous lineage is GATE_BLOCKED.
 */
export async function POST(request: Request, ctx: { params: Promise<{ contentId: string }> }) {
  try {
    const actor = await requireMutation(request);
    const { contentId } = await ctx.params;
    if (!contentIdSchema.safeParse(contentId).success) throw new AppError('VALIDATION_FAILED');
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AppError('VALIDATION_FAILED');
    const { repo } = getServices();
    // The approval must belong to this X row's resolved Threads row.
    const all = await repo.listSchedule();
    const th = all.find((r) => r.value.contentId === parsed.data.threadsContentId);
    if (th && th.value.parentContentId && th.value.parentContentId !== contentId) throw new AppError('CONFLICT', { reason: 'parent_mismatch' });
    const result = await approveAdaptation(repo, actor, parsed.data);
    return resultResponse(result);
  } catch (error) {
    return errorResponse(error);
  }
}
