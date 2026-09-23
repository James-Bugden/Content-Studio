import { getServices } from '@/application/container';
import { runVisualAction, visualActionSchema } from '@/application/visuals';
import { AppError, ERROR_CATALOGUE } from '@/domain/errors';
import { requireMutation } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * Visual Studio actions (CS-012): decide, save brief, render a revision, approve
 * the exact revision, or check a screenshot id for reuse. Owner, same origin,
 * validated body, expected revision and operation id. Gates run here, server-side.
 */
export async function POST(request: Request, ctx: { params: Promise<{ libraryId: string }> }) {
  try {
    const actor = await requireMutation(request);
    const { libraryId } = await ctx.params;
    const body: unknown = await request.json().catch(() => null);
    const parsed = visualActionSchema.safeParse(body);
    if (!parsed.success || parsed.data.libraryId !== libraryId) throw new AppError('VALIDATION_FAILED');
    const { repo, drive } = getServices();
    const outcome = await runVisualAction(repo, drive, actor, parsed.data);
    if (outcome.ok) return json(outcome);
    const entry = ERROR_CATALOGUE[outcome.code];
    return json({ ...outcome, message: outcome.message ?? entry.message, recovery: entry.recovery }, { status: entry.status });
  } catch (error) {
    return errorResponse(error);
  }
}
