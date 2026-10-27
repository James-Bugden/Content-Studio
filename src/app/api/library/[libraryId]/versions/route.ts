import { after } from 'next/server';
import { getServices } from '@/application/container';
import { savePostVersions, versionSaveSchema } from '@/application/post-versions';
import { libraryIdSchema } from '@/domain/mutation';
import { AppError } from '@/domain/errors';
import { requireMutation } from '@/lib/auth';
import { errorResponse, resultResponse } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ libraryId: string }> }) {
  try {
    const actor = await requireMutation(request);
    const { libraryId } = await ctx.params;
    const input = versionSaveSchema.safeParse(await request.json().catch(() => null));
    if (!libraryIdSchema.safeParse(libraryId).success || !input.success) throw new AppError('VALIDATION_FAILED');
    const { repo, markdownExport } = getServices();
    const result = await savePostVersions(repo, actor, libraryId, input.data);
    if (result.ok && markdownExport) after(() => markdownExport.run());
    return resultResponse(result);
  } catch (error) { return errorResponse(error); }
}
