import { getServices } from '@/application/container';
import { snapshotSheets } from '@/application/sheet-mirror';
import { AppError } from '@/domain/errors';
import { SupabaseSheetMirrorStore } from '@/integrations/supabase/sheet-mirror-store';
import { requireMutation } from '@/lib/auth';
import { serverEnv } from '@/lib/env';
import { errorResponse, json } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * Owner-triggered complete Sheet snapshot. Sheets are read first and remain the
 * authority; the transactional mirror RPC is called only after every collection
 * was read successfully. The response contains counts/hashes, never content.
 */
export async function POST(request: Request) {
  try {
    await requireMutation(request);
    const env = serverEnv();
    if (
      env.SUPABASE_READ_MODEL_MODE === 'off' ||
      !env.SUPABASE_READ_MODEL_URL ||
      !env.SUPABASE_READ_MODEL_SERVICE_KEY ||
      !env.SUPABASE_READ_MODEL_SOURCE_KEY
    ) {
      throw new AppError('CONFIG_MISSING', { provider: 'supabase' });
    }
    const store = new SupabaseSheetMirrorStore({ url: env.SUPABASE_READ_MODEL_URL, serviceKey: env.SUPABASE_READ_MODEL_SERVICE_KEY });
    const result = await snapshotSheets(getServices().repo, store, { sourceKey: env.SUPABASE_READ_MODEL_SOURCE_KEY });
    return json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
