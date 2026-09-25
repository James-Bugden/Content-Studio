import 'server-only';
import { getServices } from '@/application/container';
import { snapshotSheets } from '@/application/sheet-mirror';
import { AppError } from '@/domain/errors';
import { SupabaseSheetMirrorStore } from '@/integrations/supabase/sheet-mirror-store';
import { serverEnv } from './env';

/** Run one complete Sheet-first snapshot using server-only configuration. */
export async function runConfiguredSheetMirror() {
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
  return snapshotSheets(getServices().repo, store, { sourceKey: env.SUPABASE_READ_MODEL_SOURCE_KEY });
}
