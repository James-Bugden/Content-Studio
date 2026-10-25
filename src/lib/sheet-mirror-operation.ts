import 'server-only';
import { randomUUID } from 'node:crypto';
import { getServices } from '@/application/container';
import { buildSheetMirrorSnapshot, evidenceHash, mirrorHash } from '@/application/sheet-mirror';
import { assertImportMode, buildTypedImport, importVersions } from '@/application/content-import';
import { AppError } from '@/domain/errors';
import { SupabaseSheetMirrorStore } from '@/integrations/supabase/sheet-mirror-store';
import { serverEnv } from './env';

type Trigger = { kind: 'owner'; idempotencyKey: string } | { kind: 'scheduled' };
type RunResult = { status: 'completed' | 'replayed' | 'in_progress'; runId: string; snapshotHash?: string; counts?: unknown; hashes?: unknown; exceptions?: unknown };
// Shared across Next page/route module graphs, scoped to the services instance.
const stateKey = Symbol.for('content-studio.import-guard');
const globalState = globalThis as unknown as Record<symbol, WeakMap<object, { active?: string; completed: Map<string, RunResult> }> | undefined>;
const states = globalState[stateKey] ??= new WeakMap();

/** Run one complete Sheet-first snapshot using server-only configuration. */
async function execute(trigger: Trigger, requestId: string): Promise<RunResult> {
  const env = serverEnv();
  const services = getServices();
  if (services.contentParity?.gap === 'CONFIG_MISSING') throw new AppError('CONFIG_MISSING', { provider: 'db' });
  const sourceKey = env.SUPABASE_READ_MODEL_SOURCE_KEY ?? (env.CS_DATA_MODE === 'fake' ? 'synthetic_workbook' : undefined);
  if (!sourceKey) throw new AppError('CONFIG_MISSING', { provider: 'supabase' });
  if (services.contentImport) {
    assertImportMode();
    const operationId = `${trigger.kind}:${sourceKey}:${requestId}`;
    let token: string | undefined;
    try {
      if (services.contentImport.claim) {
        const claim = await services.contentImport.claim(operationId, mirrorHash(['phase-a', trigger.kind, sourceKey, requestId]));
        if (claim.status === 'in_progress') return { status: 'in_progress', runId: requestId };
        if (claim.status === 'replayed') return { status: 'replayed', runId: requestId, ...(claim.result as object) };
        token = claim.token;
      }
      const versions = await importVersions(services.contentImport.db);
      const snapshot = await buildSheetMirrorSnapshot(services.importRepo ?? services.repo, { sourceKey, runId: requestId });
      const typed = buildTypedImport(snapshot, versions, evidenceHash(['content-import', trigger.kind, sourceKey]));
      // Durable ledger identity records the non-personal trigger class and configured
      // source key. The owner request key is reused on network retries.
      typed.operationId = operationId;
      await services.contentImport.applyImport(typed, token);
      services.contentParity?.imported(Date.parse(snapshot.startedAt), typed);
      return { status: 'completed', runId: snapshot.runId, snapshotHash: typed.snapshotHash, counts: typed.counts, hashes: typed.hashes, exceptions: typed.exceptions };
    } catch (error) {
      services.contentParity?.failed(Date.now());
      if (token) await services.contentImport.release?.(operationId, token).catch(() => { /* Expiry fences abandoned work if the DB is unavailable. */ });
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
  const result = await store.applySnapshot(await buildSheetMirrorSnapshot(services.importRepo ?? services.repo, { sourceKey, runId: requestId }));
  return { status: result.replayed ? 'replayed' : 'completed', runId: result.runId, snapshotHash: result.snapshotHash };
}

/** A second click is an explicit no-op; errors release the guard for retry. */
export async function runConfiguredSheetMirror(trigger: Trigger): Promise<RunResult> {
  // Neither the typed importer nor the legacy mirror may read/copy Sheet
  // authority after write cutover, even when legacy mirror flags remain set.
  if (serverEnv().CS_CONTENT_STORE === 'db-shadow' && serverEnv().SUPABASE_READ_MODEL_MODE === 'mirror') {
    throw new AppError('CONFIG_MISSING', { reason: 'legacy_mirror_refused_in_db_shadow_disable_mirror_mode', message: 'Legacy mirror refresh is refused in db-shadow. Set SUPABASE_READ_MODEL_MODE=off before typed imports; the legacy mirror will no longer refresh.' });
  }
  if (serverEnv().CS_CONTENT_STORE === 'db') throw new AppError('FORBIDDEN', { reason: 'imports_disabled_in_db_mode' });
  if (trigger.kind === 'owner' && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trigger.idempotencyKey)) {
    throw new AppError('VALIDATION_FAILED', { reason: 'import_idempotency_key' });
  }
  if (trigger.kind === 'owner') trigger = { ...trigger, idempotencyKey: trigger.idempotencyKey.toLowerCase() };
  const services = getServices();
  if (services.mode === 'live' && services.contentImport) {
    // A scheduled redelivery in the same 15-minute slot has durable identity.
    const digest = mirrorHash(['scheduled', serverEnv().SUPABASE_READ_MODEL_SOURCE_KEY, Math.floor(Date.now() / 900_000)]);
    const scheduledId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
    const result = await execute(trigger, trigger.kind === 'owner' ? trigger.idempotencyKey : scheduledId);
    // A Phase C repair changes the admitted import identity. Re-measure the
    // complete derived read model before this run can report success. Replays
    // can finish this step after an interrupted measurement without reimport.
    if (serverEnv().CS_CONTENT_STORE === 'db-read' && result.status !== 'in_progress') await services.liveCutover?.measure();
    return result;
  }
  const state = states.get(services) ?? { completed: new Map<string, RunResult>() };
  states.set(services, state);
  const requestId = trigger.kind === 'owner' ? trigger.idempotencyKey : randomUUID();
  const old = state.completed.get(requestId);
  if (old) return { ...old, status: 'replayed' };
  if (state.active) return { status: 'in_progress', runId: state.active };
  state.active = requestId;
  try {
    const result = await execute(trigger, requestId);
    state.completed.set(requestId, result);
    if (state.completed.size > 100) state.completed.delete(state.completed.keys().next().value!);
    return result;
  } finally { state.active = undefined; }
}
