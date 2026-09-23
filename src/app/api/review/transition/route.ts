import { getServices } from '@/application/container';
import { applyReviewTransition, reviewTransitionSchema } from '@/application/review';
import { AppError, ERROR_CATALOGUE } from '@/domain/errors';
import { requireMutation } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * Review transitions (CS-007 REV-04/REV-06). Owner, same origin, validated body,
 * expected revision and operation id. The gate engine runs here, server-side,
 * whatever the UI showed.
 */
export async function POST(request: Request) {
  try {
    const actor = await requireMutation(request);
    const body: unknown = await request.json().catch(() => null);
    const parsed = reviewTransitionSchema.safeParse(body);
    if (!parsed.success) throw new AppError('VALIDATION_FAILED');
    const outcome = await applyReviewTransition(getServices().repo, actor, parsed.data);
    if (outcome.ok) return json(outcome);
    const entry = ERROR_CATALOGUE[outcome.code];
    return json({ ...outcome, message: entry.message, recovery: entry.recovery }, { status: entry.status });
  } catch (error) {
    return errorResponse(error);
  }
}
