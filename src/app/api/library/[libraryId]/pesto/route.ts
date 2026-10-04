import { getServices } from '@/application/container';
import { applyLibraryPestoEdit, libraryPestoEditSchema } from '@/application/backlog';
import { AppError, ERROR_CATALOGUE } from '@/domain/errors';
import { requireMutation } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * PESTO edit on a Content Library post (CS-054). Owner, same origin, validated
 * body, expected revision and operation id, like every other guarded write. The
 * post id in the path must match the body.
 */
export async function POST(request: Request, ctx: { params: Promise<{ libraryId: string }> }) {
  try {
    const actor = await requireMutation(request);
    const { libraryId } = await ctx.params;
    const body: unknown = await request.json().catch(() => null);
    const parsed = libraryPestoEditSchema.safeParse(body);
    if (!parsed.success || parsed.data.libraryId !== libraryId) throw new AppError('VALIDATION_FAILED');
    const outcome = await applyLibraryPestoEdit(getServices().repo, actor, parsed.data);
    if (outcome.ok) return json(outcome);
    const entry = ERROR_CATALOGUE[outcome.code];
    return json({ ...outcome, message: entry.message, recovery: entry.recovery }, { status: entry.status });
  } catch (error) {
    return errorResponse(error);
  }
}
