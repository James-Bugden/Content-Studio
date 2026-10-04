import { getServices } from '@/application/container';
import { libraryBacklogTotals } from '@/domain/library-backlog';
import { requireActor } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Whole-Library approved / queued totals for the Backlog header (CS-059). Counts only; no post content. */
export async function GET() {
  try {
    await requireActor('viewer');
    return json({ ok: true, totals: libraryBacklogTotals(await getServices().repo.listLibrary()) });
  } catch (error) {
    return errorResponse(error);
  }
}
