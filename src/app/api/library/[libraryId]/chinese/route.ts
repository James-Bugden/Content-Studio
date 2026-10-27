import { z } from 'zod';
import { getServices } from '@/application/container';
import { proposePostChinese } from '@/application/post-versions';
import { libraryIdSchema } from '@/domain/mutation';
import { AppError } from '@/domain/errors';
import { requireMutation } from '@/lib/auth';
import { errorResponse, resultResponse } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ libraryId: string }> }) {
  try {
    await requireMutation(request);
    const { libraryId } = await ctx.params;
    const input = z.object({ source: z.string().min(1).max(30_000) }).strict().safeParse(await request.json().catch(() => null));
    if (!libraryIdSchema.safeParse(libraryId).success || !input.success) throw new AppError('VALIDATION_FAILED');
    const { repo, ai } = getServices();
    return resultResponse(await proposePostChinese(repo, ai, libraryId, input.data.source, request.signal));
  } catch (error) { return errorResponse(error); }
}
