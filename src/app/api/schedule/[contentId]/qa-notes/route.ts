import { z } from 'zod';
import { getServices } from '@/application/container';
import { saveQaNotes } from '@/application/english-qa';
import { AppError } from '@/domain/errors';
import { contentIdSchema, operationIdSchema, revisionSchema } from '@/domain/mutation';
import { requireMutation } from '@/lib/auth';
import { errorResponse, resultResponse } from '@/lib/http';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  operationId: operationIdSchema,
  expectedRevision: revisionSchema,
  summary: z.string().min(1).max(2000),
  /** Must be true: the summary is written only after an explicit confirmation. */
  confirmed: z.literal(true),
});

/** Write an English QA summary to Schedule `AI Review Notes` after explicit confirmation (CS-009). */
export async function POST(request: Request, ctx: { params: Promise<{ contentId: string }> }) {
  try {
    const actor = await requireMutation(request);
    const { contentId } = await ctx.params;
    if (!contentIdSchema.safeParse(contentId).success) throw new AppError('VALIDATION_FAILED');
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AppError('VALIDATION_FAILED');
    const { operationId, expectedRevision, summary } = parsed.data;
    const result = await saveQaNotes(getServices().repo, actor, { operationId, contentId, expectedRevision, summary });
    return resultResponse(result);
  } catch (error) {
    return errorResponse(error);
  }
}
