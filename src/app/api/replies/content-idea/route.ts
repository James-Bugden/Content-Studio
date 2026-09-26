import { getServices } from '@/application/container';
import { replyContentIdeaSchema, saveReplyAsContentIdea } from '@/application/backlog';
import { AppError, ERROR_CATALOGUE } from '@/domain/errors';
import { requireMutation } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { getOwnerSession, type OwnerSession } from '@/replies/lib/auth/owner';
import { getStore, isTestMode } from '@/replies/lib/server/get-store';
import { TEST_OWNER_ID } from '@/replies/lib/server/test-mode';

export const dynamic = 'force-dynamic';

/** Save a posted Reply into the existing Google Sheet Content Queue. */
export async function POST(request: Request) {
  try {
    const actor = await requireMutation(request);
    const body: unknown = await request.json().catch(() => null);
    const parsed = replyContentIdeaSchema.safeParse(body);
    if (!parsed.success) throw new AppError('VALIDATION_FAILED');
    // The posted text and platform come from the owner-scoped Replies store,
    // never from the browser (which may be stale or tampered with).
    const session = isTestMode()
      ? ({ userId: TEST_OWNER_ID, supabase: null as never } satisfies OwnerSession)
      : await getOwnerSession();
    if (!session) throw new AppError('CONFIG_MISSING');
    const recorded = await getStore(session).getRecordedReplyForIdea(parsed.data.replyId);
    if (!recorded) throw new AppError('NOT_FOUND');
    const outcome = await saveReplyAsContentIdea(getServices().repo, actor, parsed.data, recorded);
    if (outcome.ok) return json(outcome);
    const entry = ERROR_CATALOGUE[outcome.code];
    return json(
      { ...outcome, message: entry.message, recovery: entry.recovery },
      { status: entry.status },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
