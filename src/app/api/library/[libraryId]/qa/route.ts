import { z } from 'zod';
import { getServices } from '@/application/container';
import { MAX_QA_DRAFT_CHARS, runEnglishQa } from '@/application/english-qa';
import { AppError } from '@/domain/errors';
import { fingerprint } from '@/domain/hash';
import { libraryIdSchema, revisionSchema } from '@/domain/mutation';
import { requireMutation } from '@/lib/auth';
import { errorResponse, resultResponse } from '@/lib/http';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  draft: z.string().min(1).max(MAX_QA_DRAFT_CHARS),
  draftHash: revisionSchema,
});

/**
 * English QA (CS-009 ENQA-01). Advisory: returns findings bound to the exact draft
 * the editor sent and writes nothing. The platform comes from the Library row, not
 * the client.
 */
export async function POST(request: Request, ctx: { params: Promise<{ libraryId: string }> }) {
  try {
    await requireMutation(request);
    const { libraryId } = await ctx.params;
    if (!libraryIdSchema.safeParse(libraryId).success) throw new AppError('VALIDATION_FAILED');
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AppError('VALIDATION_FAILED');
    const { draft, draftHash } = parsed.data;
    if (fingerprint(draft) !== draftHash) throw new AppError('STALE_READ', { reason: 'draft_hash_mismatch' });
    const { repo, ai } = getServices();
    const record = await repo.getLibrary(libraryId);
    const platform = record.value.targetPlatform;
    if (!platform.ok) throw new AppError('VALIDATION_FAILED', { reason: 'platform_unrecognised' });
    const result = await runEnglishQa({ ai, libraryId, draft, draftHash, platform: platform.value, signal: request.signal });
    return resultResponse(result);
  } catch (error) {
    return errorResponse(error);
  }
}
