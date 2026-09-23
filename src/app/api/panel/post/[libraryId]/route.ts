import { getServices } from '@/application/container';
import { loadPostPanel } from '@/application/panel';
import { AppError } from '@/domain/errors';
import { libraryIdSchema } from '@/domain/mutation';
import { requireActor } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Everything the post side panel needs, in one read (UX redesign). */
export async function GET(_request: Request, ctx: { params: Promise<{ libraryId: string }> }) {
  try {
    const actor = await requireActor('viewer');
    const { libraryId } = await ctx.params;
    if (!libraryIdSchema.safeParse(libraryId).success) throw new AppError('VALIDATION_FAILED');
    return json({ ok: true, data: await loadPostPanel(getServices(), actor, libraryId) });
  } catch (error) {
    return errorResponse(error);
  }
}
