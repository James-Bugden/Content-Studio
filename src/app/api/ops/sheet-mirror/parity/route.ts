import { getServices } from '@/application/container';
import { buildSheetMirrorSnapshot } from '@/application/sheet-mirror';
import { compareSheetMirror } from '@/application/sheet-mirror-parity';
import { AppError } from '@/domain/errors';
import { SupabaseSheetMirrorStore } from '@/integrations/supabase/sheet-mirror-store';
import { requireMutation } from '@/lib/auth';
import { serverEnv } from '@/lib/env';
import { errorResponse, json } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Owner-only shadow comparison. The response is deliberately content- and ID-free. */
export async function POST(request: Request) {
  try {
    await requireMutation(request);
    const env = serverEnv();
    if (
      env.SUPABASE_READ_MODEL_MODE !== 'shadow' ||
      !env.SUPABASE_READ_MODEL_URL ||
      !env.SUPABASE_READ_MODEL_SERVICE_KEY ||
      !env.SUPABASE_READ_MODEL_SOURCE_KEY
    ) {
      throw new AppError('CONFIG_MISSING', { provider: 'supabase' });
    }
    const store = new SupabaseSheetMirrorStore({ url: env.SUPABASE_READ_MODEL_URL, serviceKey: env.SUPABASE_READ_MODEL_SERVICE_KEY });
    const snapshot = await buildSheetMirrorSnapshot(getServices().repo, { sourceKey: env.SUPABASE_READ_MODEL_SOURCE_KEY });
    const report = compareSheetMirror(snapshot, await store.readActive(env.SUPABASE_READ_MODEL_SOURCE_KEY));
    return json({ ok: true, ...report });
  } catch (error) {
    return errorResponse(error);
  }
}
