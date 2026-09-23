import { getServices } from '@/application/container';
import { loadSlotPanel } from '@/application/panel';
import { AppError } from '@/domain/errors';
import { contentIdSchema } from '@/domain/mutation';
import { requireActor } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Everything the slot side panel needs, in one read (UX redesign). */
export async function GET(_request: Request, ctx: { params: Promise<{ contentId: string }> }) {
  try {
    const actor = await requireActor('viewer');
    const { contentId } = await ctx.params;
    if (!contentIdSchema.safeParse(contentId).success) throw new AppError('VALIDATION_FAILED');
    return json({ ok: true, data: await loadSlotPanel(getServices(), actor, contentId) });
  } catch (error) {
    return errorResponse(error);
  }
}
