import { getServices } from '@/application/container';
import { generateAdaptation } from '@/application/zh-tw';
import { loadAdaptationView } from '@/application/zh-view';
import { AppError } from '@/domain/errors';
import { contentIdSchema } from '@/domain/mutation';
import { requireActor, requireMutation } from '@/lib/auth';
import { errorResponse, json, resultResponse } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Current adaptation state, the X source and the linked Threads row (CS-011). Read only. */
export async function GET(_request: Request, ctx: { params: Promise<{ contentId: string }> }) {
  try {
    await requireActor('viewer');
    const { contentId } = await ctx.params;
    if (!contentIdSchema.safeParse(contentId).success) throw new AppError('VALIDATION_FAILED');
    return json({ ok: true, view: await loadAdaptationView(getServices().repo, contentId) });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Generate a zh-TW adaptation of approved X copy (CS-011 ZHTW-01/02). Writes
 * nothing; the proposal carries the exact X copy it was made from so saving can
 * refuse a result made from older copy.
 */
export async function POST(request: Request, ctx: { params: Promise<{ contentId: string }> }) {
  try {
    await requireMutation(request);
    const { contentId } = await ctx.params;
    if (!contentIdSchema.safeParse(contentId).success) throw new AppError('VALIDATION_FAILED');
    const { repo, ai } = getServices();
    const result = await generateAdaptation({ ai, repo, sourceContentId: contentId, signal: request.signal });
    return resultResponse(result);
  } catch (error) {
    return errorResponse(error);
  }
}
