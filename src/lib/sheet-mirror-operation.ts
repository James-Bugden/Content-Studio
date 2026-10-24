import 'server-only';
import { randomUUID } from 'node:crypto';
import { getServices } from '@/application/container';
import { buildSheetMirrorSnapshot, evidenceHash } from '@/application/sheet-mirror';
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
  const sourceKey = env.SUPABASE_READ_MODEL_SOURCE_KEY ?? (env.CS_DATA_MODE === 'fake' ? 'synthetic_workbook' : undefined);
  if (!sourceKey) throw new AppError('CONFIG_MISSING', { provider: 'supabase' });
  if (services.contentImport) {
    assertImportMode();
    try {
      const versions = await importVersions(services.contentImport.db);
      const snapshot = await buildSheetMirrorSnapshot(services.importRepo ?? services.repo, { sourceKey, runId: requestId });
      const typed = buildTypedImport(snapshot, versions, evidenceHash(['content-import', trigger.kind, sourceKey]));
      // Durable ledger identity records the non-personal trigger class and configured
      // source key. The owner request key is reused on network retries.
      typed.operationId = `${trigger.kind}:${sourceKey}:${requestId}`;
      await services.contentImport.applyImport(typed);
      services.contentParity?.imported(Date.parse(snapshot.startedAt), typed);
      return { status: 'completed', runId: snapshot.runId, snapshotHash: typed.snapshotHash, counts: typed.counts, hashes: typed.hashes, exceptions: typed.exceptions };
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
  const result = await store.applySnapshot(await buildSheetMirrorSnapshot(services.importRepo ?? services.repo, { sourceKey, runId: requestId }));
  return { status: result.replayed ? 'replayed' : 'completed', runId: result.runId, snapshotHash: result.snapshotHash };
}

/** A second click is an explicit no-op; errors release the guard for retry. */
export async function runConfiguredSheetMirror(trigger: Trigger): Promise<RunResult> {
  if (trigger.kind === 'owner' && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trigger.idempotencyKey)) {
    throw new AppError('VALIDATION_FAILED', { reason: 'import_idempotency_key' });
  }
  const services = getServices();
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
