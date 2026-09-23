import { getServices } from '@/application/container';
import { loadEditor } from '@/application/editor';
import { AppError } from '@/domain/errors';
import { libraryIdSchema } from '@/domain/mutation';
import { requireActor } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Fresh authoritative editor model: Sheet row and Markdown section with revisions (CS-008). */
export async function GET(_request: Request, ctx: { params: Promise<{ libraryId: string }> }) {
  try {
    await requireActor('viewer');
    const { libraryId } = await ctx.params;
    if (!libraryIdSchema.safeParse(libraryId).success) throw new AppError('VALIDATION_FAILED');
    const { repo, drive } = getServices();
    return json({ ok: true, model: await loadEditor(repo, drive, libraryId) });
  } catch (error) {
    return errorResponse(error);
  }
}
