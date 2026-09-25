import { requireMutation } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { runConfiguredSheetMirror } from '@/lib/sheet-mirror-operation';

export const dynamic = 'force-dynamic';

/**
 * Owner-triggered complete Sheet snapshot. Sheets are read first and remain the
 * authority; the transactional mirror RPC is called only after every collection
 * was read successfully. The response contains counts/hashes, never content.
 */
export async function POST(request: Request) {
  try {
    await requireMutation(request);
    return json({ ok: true, ...(await runConfiguredSheetMirror()) });
  } catch (error) {
    return errorResponse(error);
  }
}
