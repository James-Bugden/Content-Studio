import { z } from 'zod';
import { getServices } from '@/application/container';
import { selectHook } from '@/application/hooks';
import { AppError } from '@/domain/errors';
import { libraryIdSchema, operationIdSchema, revisionSchema } from '@/domain/mutation';
import { requireMutation } from '@/lib/auth';
import { errorResponse, resultResponse } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Shape only; the service validates the alternatives and the choice in depth. */
const bodySchema = z.object({
  operationId: operationIdSchema,
  expectedSheetRevision: revisionSchema,
  expectedSectionHash: revisionSchema,
  generationDraftHash: revisionSchema,
  choice: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('current') }),
    z.object({ kind: z.literal('alternative'), index: z.number().int().min(0).max(2), alternative: z.unknown() }),
  ]),
  alternatives: z.array(z.unknown()).max(6),
});

/**
 * Explicit hook choice (CS-010 HOOK-03/05). Owner only, same origin, version-bound:
 * the service refuses a generation made for an older draft and reports a partial
 * saga truthfully so the same operation id can finish it.
 */
export async function POST(request: Request, ctx: { params: Promise<{ libraryId: string }> }) {
  try {
    const actor = await requireMutation(request);
    const { libraryId } = await ctx.params;
    if (!libraryIdSchema.safeParse(libraryId).success) throw new AppError('VALIDATION_FAILED');
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AppError('VALIDATION_FAILED');
    const { repo, drive } = getServices();
    // The service re-parses both with the strict hook schemas.
    const input = parsed.data as unknown as Parameters<typeof selectHook>[3];
    const result = await selectHook(repo, drive, actor, { ...input, libraryId });
    return resultResponse(result);
  } catch (error) {
    return errorResponse(error);
  }
}
