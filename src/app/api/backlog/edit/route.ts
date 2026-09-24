import { getServices } from '@/application/container';
import { applyBacklogEdit, backlogEditSchema } from '@/application/backlog';
import { AppError, ERROR_CATALOGUE } from '@/domain/errors';
import { requireMutation } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * Backlog edits (Content Queue). Owner, same origin, validated body, expected
 * revision and operation id, exactly like Review transitions.
 */
export async function POST(request: Request) {
  try {
    const actor = await requireMutation(request);
    const body: unknown = await request.json().catch(() => null);
    const parsed = backlogEditSchema.safeParse(body);
    if (!parsed.success) throw new AppError('VALIDATION_FAILED');
    const outcome = await applyBacklogEdit(getServices().repo, actor, parsed.data);
    if (outcome.ok) return json(outcome);
    const entry = ERROR_CATALOGUE[outcome.code];
    return json({ ...outcome, message: entry.message, recovery: entry.recovery }, { status: entry.status });
  } catch (error) {
    return errorResponse(error);
  }
}
