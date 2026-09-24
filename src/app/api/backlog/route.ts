import { getServices } from '@/application/container';
import { loadBacklogGroups } from '@/application/backlog';
import { requireActor } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** The Content Queue backlog, grouped by source. */
export async function GET() {
  try {
    await requireActor('viewer');
    return json({ ok: true, data: await loadBacklogGroups(getServices().repo) });
  } catch (error) {
    return errorResponse(error);
  }
}
