import 'server-only';
import { getServices } from '@/application/container';
import { createContentBackup } from '@/application/content-backup';
import { serverEnv } from './env';
import { AppError } from '@/domain/errors';
import { z } from 'zod';
import { mirrorHash } from '@/application/sheet-mirror';

/** Called only after route authentication. Scheduling is owner configuration;
 * no live adapter is available, and fake production startup is also refused. */
export async function repairContentExport() {
  const services = getServices();
  if (serverEnv().CS_CONTENT_STORE !== 'db' || !services.contentCutover) throw new AppError('FORBIDDEN', { reason: 'export_store_mode' });
  // Both repairs get an attempt; a queue read failure must not skip Sheet repair.
  const [markdown, sheet] = await Promise.allSettled([services.markdownExport?.run(), services.contentCutover.exporter.run()]);
  if (sheet.status === 'rejected') throw sheet.reason;
  if (markdown.status === 'rejected') throw markdown.reason;
  const parity = sheet.value;
  return { ...parity, comparison: services.contentCutover.exporter.comparison(Date.now(), services.contentCutover.mutationCount) };
}
type BackupRun = { status: string; manifestHash: string; verifiedAt?: number };
const activeBackups = new WeakMap<object, Promise<BackupRun>>();
export async function scheduledContentBackup(now = Date.now()) {
  const services = getServices(), backup = services.contentBackup;
  if (serverEnv().CS_CONTENT_STORE !== 'db' || !backup) throw new AppError('FORBIDDEN', { reason: 'backup_store_mode' });
  if (services.liveCutover) {
    const digest = mirrorHash(['scheduled-backup', serverEnv().SUPABASE_READ_MODEL_SOURCE_KEY, Math.floor((now + 8 * 3600_000) / 86400_000)]);
    const id = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
    return z.object({ status: z.literal('verified'), manifestHash: z.string().regex(/^[a-f0-9]{64}$/), verifiedAt: z.number() }).parse(await services.liveCutover.execute('backup', id));
  }
  const day = (time: number) => new Date(time + 8 * 3600_000).toISOString().slice(0, 10);
  const old = backup.journal.lastVerified;
  if (old && day(old.verifiedAt) === day(now)) return { status: 'already_verified', manifestHash: old.manifestHash };
  const active = activeBackups.get(backup);
  if (active) return active;
  const run = createContentBackup(backup.source, backup.folder, backup.journal, now).then(result => ({ status: 'verified', manifestHash: result.manifestHash, verifiedAt: result.verifiedAt }));
  activeBackups.set(backup, run);
  try { return await run; } finally { activeBackups.delete(backup); }
}
