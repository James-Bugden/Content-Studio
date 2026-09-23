import { z } from 'zod';
import { getServices } from '@/application/container';
import { saveDraft } from '@/application/draft-save';
import { AppError, ERROR_CATALOGUE } from '@/domain/errors';
import { libraryIdSchema, operationIdSchema, revisionSchema } from '@/domain/mutation';
import { requireMutation } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  operationId: operationIdSchema,
  expectedSheetRevision: revisionSchema,
  expectedSectionHash: revisionSchema,
  proposed: z.string().max(40_000),
});

/** Explicit authoritative draft save (CS-008). Autosave never calls this. */
export async function POST(request: Request, ctx: { params: Promise<{ libraryId: string }> }) {
  try {
    const actor = await requireMutation(request);
    const { libraryId } = await ctx.params;
    if (!libraryIdSchema.safeParse(libraryId).success) throw new AppError('VALIDATION_FAILED');
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AppError('VALIDATION_FAILED');
    const { repo, drive } = getServices();
    const result = await saveDraft(repo, drive, { ...parsed.data, actor, libraryId });
    if (result.ok) return json(result);
    const entry = ERROR_CATALOGUE[result.code];
    return json({ ...result, message: entry.message, recovery: entry.recovery }, { status: entry.status });
  } catch (error) {
    return errorResponse(error);
  }
}
