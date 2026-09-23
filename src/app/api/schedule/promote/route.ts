import { z } from 'zod';
import { getServices } from '@/application/container';
import { promote } from '@/application/schedule';
import { AppError, ERROR_CATALOGUE } from '@/domain/errors';
import { contentIdSchema, libraryIdSchema, operationIdSchema, revisionSchema } from '@/domain/mutation';
import { requireMutation } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  operationId: operationIdSchema,
  libraryId: libraryIdSchema,
  contentId: contentIdSchema,
  expectedLibraryRevision: revisionSchema,
  expectedScheduleRevision: revisionSchema,
});

/** Confirmed promotion of a Ready Library item into one Schedule slot (CS-014). */
export async function POST(request: Request) {
  try {
    const actor = await requireMutation(request);
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AppError('VALIDATION_FAILED');
    const result = await promote(getServices().repo, actor, parsed.data);
    if (result.ok) return json(result);
    const entry = ERROR_CATALOGUE[result.code];
    return json({ ...result, message: entry.message, recovery: entry.recovery }, { status: entry.status });
  } catch (error) {
    return errorResponse(error);
  }
}
