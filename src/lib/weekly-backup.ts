import 'server-only';
import { createHash } from 'node:crypto';
import { AppError } from '@/domain/errors';
import { backupWarning, type BackupStatus } from '@/domain/weekly-backup';
import { pingHeartbeat, runWeeklyBackup, type WeeklyBackupDeps, type WeeklyBackupResult } from '@/application/weekly-backup';
import type { WeeklyBackupSignal } from '@/application/reconcile';
import { GoogleDriveGateway } from '@/integrations/google/google-drive';
import { FakeBackupDrive } from '@/integrations/google/fake-backup-drive';
import { ServiceAccountTokens } from '@/integrations/google/service-account';
import { PostgrestBackupRowSource } from '@/integrations/supabase/backup-row-source';
import { FakeBackupRowSource, syntheticBackupTables } from '@/integrations/supabase/fake-backup-source';
import { FakeBackupRunStore, SupabaseBackupRunStore } from '@/integrations/supabase/backup-run-store';
import type { BackupRunStore } from '@/application/backup-ports';
import { serverEnv } from './env';

/** Server-only wiring of the weekly backup from environment (#249). Names only; values are never logged. */
const KEY = Symbol.for('content-studio.weekly-backup-fakes');
type Fakes = { source: FakeBackupRowSource; drive: FakeBackupDrive; runs: FakeBackupRunStore };
const fakes = (): Fakes => {
  const g = globalThis as unknown as Record<symbol, Fakes | undefined>;
  return g[KEY] ??= { source: new FakeBackupRowSource(syntheticBackupTables()), drive: new FakeBackupDrive(['SYNTH_backup_folder']), runs: new FakeBackupRunStore() };
};

const commit = () => {
  const env = serverEnv();
  const sha = env.VERCEL_GIT_COMMIT_SHA ?? env.CS_COMMIT_SHA;
  return sha && /^[a-f0-9]{7,64}$/i.test(sha) ? sha : null;
};

function liveRunStore(): BackupRunStore {
  const env = serverEnv();
  if (!env.SUPABASE_READ_MODEL_URL || !env.SUPABASE_READ_MODEL_SERVICE_KEY) throw new AppError('CONFIG_MISSING', { provider: 'supabase' });
  return new SupabaseBackupRunStore({ url: env.SUPABASE_READ_MODEL_URL, serviceKey: env.SUPABASE_READ_MODEL_SERVICE_KEY });
}

export function weeklyBackupDeps(): WeeklyBackupDeps {
  const env = serverEnv();
  const ping = (ok: boolean) => pingHeartbeat(env.HEALTHCHECK_PING_URL, ok);
  if (env.CS_DATA_MODE === 'fake') {
    const f = fakes();
    return { source: f.source, drive: f.drive, runs: f.runs, folderId: 'SYNTH_backup_folder', buildCommit: null, ping };
  }
  if (!env.BACKUP_DRIVE_FOLDER_ID) throw new AppError('CONFIG_MISSING', { provider: 'drive', reason: 'backup_folder' });
  if (!env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) throw new AppError('CONFIG_MISSING', { provider: 'drive' });
  if (env.GOOGLE_WRITE_ENABLED !== 'true') throw new AppError('CONFIG_MISSING', { provider: 'drive', reason: 'write_disabled' });
  if (!env.SUPABASE_READ_MODEL_URL || !env.SUPABASE_READ_MODEL_SERVICE_KEY) throw new AppError('CONFIG_MISSING', { provider: 'supabase' });
  const tokens = new ServiceAccountTokens(env.GOOGLE_SERVICE_ACCOUNT_EMAIL, env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY);
  return {
    source: new PostgrestBackupRowSource({ url: env.SUPABASE_READ_MODEL_URL, serviceKey: env.SUPABASE_READ_MODEL_SERVICE_KEY }),
    drive: new GoogleDriveGateway(tokens, true, fetch),
    runs: liveRunStore(),
    folderId: env.BACKUP_DRIVE_FOLDER_ID,
    buildCommit: commit(),
    ping,
  };
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** A manual run needs a client-generated UUID v4 so a retried click replays instead of running twice. */
export function manualBackupId(idempotencyKey: string | null): string {
  if (!idempotencyKey || !UUID_V4.test(idempotencyKey)) throw new AppError('VALIDATION_FAILED', { reason: 'backup_idempotency_key' });
  return idempotencyKey.toLowerCase();
}
/** One scheduled run per UTC day: a redelivered cron request replays that day's run. */
export function cronBackupId(now = Date.now()): string {
  const h = createHash('sha256').update(`weekly-backup:${new Date(now).toISOString().slice(0, 10)}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export async function runConfiguredBackup(trigger: 'cron' | 'manual', id: string): Promise<WeeklyBackupResult> {
  return runWeeklyBackup(weeklyBackupDeps(), trigger, id);
}

export type BackupCard =
  | { state: 'ok'; status: BackupStatus; folderConfigured: boolean }
  | { state: 'unavailable' };

/** Reads run history only (no Drive call), so the page stays fast and never needs write access. */
export async function loadBackupCard(): Promise<BackupCard> {
  const env = serverEnv();
  try {
    if (env.CS_DATA_MODE === 'fake') return { state: 'ok', status: await fakes().runs.status(), folderConfigured: true };
    return { state: 'ok', status: await liveRunStore().status(), folderConfigured: Boolean(env.BACKUP_DRIVE_FOLDER_ID) };
  } catch {
    return { state: 'unavailable' };
  }
}

/** The signal that feeds the Fix issues list and its nav count. Live mode only; fake mode adds no item. */
export function backupSignal(card: BackupCard, now = Date.now()): WeeklyBackupSignal | undefined {
  if (serverEnv().CS_DATA_MODE === 'fake') return undefined;
  if (card.state === 'unavailable') return { kind: 'unavailable' };
  if (!card.folderConfigured) return { kind: 'not_configured' };
  const w = backupWarning(card.status, now);
  return w.level === 'none' ? undefined : { kind: 'warning', level: w.level, message: w.message };
}
