import { getServices } from '@/application/container';
import { changePostLifecycle, postLifecycleSchema } from '@/application/post-versions';
import { libraryIdSchema } from '@/domain/mutation';
import { AppError } from '@/domain/errors';
import { requireMutation } from '@/lib/auth';
import { errorResponse, resultResponse } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ libraryId: string }> }) {
  try {
    const actor = await requireMutation(request);
    const { libraryId } = await ctx.params;
    const input = postLifecycleSchema.safeParse(await request.json().catch(() => null));
    if (!libraryIdSchema.safeParse(libraryId).success || !input.success) throw new AppError('VALIDATION_FAILED');
    return resultResponse(await changePostLifecycle(getServices().repo, actor, libraryId, input.data));
  } catch (error) { return errorResponse(error); }
}
