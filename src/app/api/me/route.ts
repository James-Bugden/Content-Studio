import { requireActor } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * Current role only (CS-005). Never the subject, email or any identifier.
 * 401 without a session, 403 for a session with no role; always no-store.
 */
export async function GET() {
  try {
    const actor = await requireActor('viewer');
    return json({ ok: true, role: actor.role });
  } catch (error) {
    return errorResponse(error);
  }
}
