import { getServices } from '@/application/container';
import { previewPromotion } from '@/application/schedule';
import { AppError } from '@/domain/errors';
import { contentIdSchema, libraryIdSchema } from '@/domain/mutation';
import { requireActor } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Read-only promotion preview for the slot panel (CS-014). Writes nothing. */
export async function GET(request: Request) {
  try {
    await requireActor('owner');
    const url = new URL(request.url);
    const libraryId = url.searchParams.get('libraryId') ?? '';
    const contentId = url.searchParams.get('contentId') ?? '';
    if (!libraryIdSchema.safeParse(libraryId).success || !contentIdSchema.safeParse(contentId).success) throw new AppError('VALIDATION_FAILED');
    return json(await previewPromotion(getServices().repo, libraryId, contentId));
  } catch (error) {
    return errorResponse(error);
  }
}
