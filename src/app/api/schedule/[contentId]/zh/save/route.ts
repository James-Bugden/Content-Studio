import { z } from 'zod';
import { getServices } from '@/application/container';
import { saveAdaptation } from '@/application/zh-tw';
import { AppError } from '@/domain/errors';
import { contentIdSchema, operationIdSchema, revisionSchema } from '@/domain/mutation';
import { requireMutation } from '@/lib/auth';
import { errorResponse, resultResponse } from '@/lib/http';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  operationId: operationIdSchema,
  threadsContentId: contentIdSchema,
  expectedRevision: revisionSchema,
  sourceHook: z.string().max(2000),
  sourceContent: z.string().max(30_000),
  hook: z.string().max(2000),
  content: z.string().max(30_000),
  confirmTakeover: z.boolean().optional(),
});

/**
 * Save a (possibly hand-edited) zh-TW adaptation for Chinese review (CS-011
 * ZHTW-03/04). Writes the Threads row only, with the lineage stamp over the exact
 * X copy; refuses if the X copy changed since generation.
 */
export async function POST(request: Request, ctx: { params: Promise<{ contentId: string }> }) {
  try {
    const actor = await requireMutation(request);
    const { contentId } = await ctx.params;
    if (!contentIdSchema.safeParse(contentId).success) throw new AppError('VALIDATION_FAILED');
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AppError('VALIDATION_FAILED');
    const result = await saveAdaptation(getServices().repo, actor, { ...parsed.data, sourceContentId: contentId });
    return resultResponse(result);
  } catch (error) {
    return errorResponse(error);
  }
}
