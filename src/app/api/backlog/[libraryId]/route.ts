import { getServices } from '@/application/container';
import { AppError } from '@/domain/errors';
import { libraryIdSchema } from '@/domain/mutation';
import { thumbFor } from '@/domain/next-steps';
import { requireActor } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Fetch one idea for the editor without downloading and serialising the entire queue. */
export async function GET(_request: Request, context: { params: Promise<{ libraryId: string }> }) {
  try {
    const actor = await requireActor('viewer');
    const { libraryId } = await context.params;
    if (!libraryIdSchema.safeParse(libraryId).success) throw new AppError('VALIDATION_FAILED');
    const record = await getServices().repo.getQueue(libraryId);
    const value = record.value;
    return json({ ok: true, canEdit: actor.role === 'owner', item: {
      libraryId: value.libraryId, revision: record.revision, row: record.row,
      hook: value.currentHook, slug: value.slug, draftContent: value.draftContent,
      thumb: thumbFor(value.libraryId, value),
    } });
  } catch (error) {
    return errorResponse(error);
  }
}
