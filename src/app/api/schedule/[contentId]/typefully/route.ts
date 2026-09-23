import { getServices } from '@/application/container';
import { loadTypefullyDetail } from '@/application/typefully-view';
import { AppError } from '@/domain/errors';
import { contentIdSchema } from '@/domain/mutation';
import { requireActor } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * Row facts plus the Typefully reconciliation state for one Schedule row
 * (CS-015 TYPE-01): linked with a copy comparison, single match, ambiguous, no
 * match or provider error. Read only; never a raw provider payload.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ contentId: string }> }) {
  try {
    await requireActor('viewer');
    const { contentId } = await ctx.params;
    if (!contentIdSchema.safeParse(contentId).success) throw new AppError('VALIDATION_FAILED');
    const { repo, typefully } = getServices();
    return json({ ok: true, view: await loadTypefullyDetail(repo, typefully, contentId) });
  } catch (error) {
    return errorResponse(error);
  }
}
