import 'server-only';
import { getServices } from '@/application/container';
import { buildSheetMirrorSnapshot, mirrorHash } from '@/application/sheet-mirror';
import { buildTypedImport, importVersions } from '@/application/content-import';
import { AppError } from '@/domain/errors';
import { SupabaseSheetMirrorStore } from '@/integrations/supabase/sheet-mirror-store';
import { serverEnv } from './env';

/** Run one complete Sheet-first snapshot using server-only configuration. */
export async function runConfiguredSheetMirror() {
  const env = serverEnv();
  const services = getServices();
  if (services.contentImport) {
    try {
      const versions = await importVersions(services.contentImport.db);
      const snapshot = await buildSheetMirrorSnapshot(services.repo, { sourceKey: 'synthetic_workbook' });
      const typed = buildTypedImport(snapshot, versions, mirrorHash('scheduled-content-import'));
      await services.contentImport.applyImport(typed);
      services.contentParity?.imported(Date.parse(snapshot.startedAt), typed);
      return { runId: snapshot.runId, snapshotHash: typed.snapshotHash, counts: typed.counts, hashes: typed.hashes, exceptions: typed.exceptions };
    } catch (error) {
      services.contentParity?.failed(Date.now());
      throw error;
    }
  }
  if (
    env.SUPABASE_READ_MODEL_MODE === 'off' ||
    !env.SUPABASE_READ_MODEL_URL ||
    !env.SUPABASE_READ_MODEL_SERVICE_KEY ||
    !env.SUPABASE_READ_MODEL_SOURCE_KEY
  ) {
    throw new AppError('CONFIG_MISSING', { provider: 'supabase' });
  }
  const store = new SupabaseSheetMirrorStore({ url: env.SUPABASE_READ_MODEL_URL, serviceKey: env.SUPABASE_READ_MODEL_SERVICE_KEY });
  return store.applySnapshot(await buildSheetMirrorSnapshot(services.repo, { sourceKey: env.SUPABASE_READ_MODEL_SOURCE_KEY }));
}
