import 'server-only';
import { randomUUID, createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { z } from 'zod';
import { canonicalJson, mirrorHash } from './sheet-mirror';
import { CONTENT_STUDIO_SCHEMA_VERSION } from '@/integrations/supabase/content-schema';
import { AppError } from '@/domain/errors';

export const BACKUP_TABLES = ['posts', 'schedule', 'workflow_settings', 'row_history', 'operations', 'audit_events'] as const;
export type BackupTable = typeof BACKUP_TABLES[number];
export type ContentBackupSnapshot = Record<BackupTable, Record<string, unknown>[]>;
export interface ContentBackupSource {
  /** All six tables in ONE repeatable-read snapshot, not six independent reads. */
  snapshot(): Promise<ContentBackupSnapshot>;
}
export interface PrivateBackupFolder {
  /** Server-configured private folder; no request-supplied folder/permissions. */
  assertPrivate(): Promise<void>;
  /** New immutable file. Repeated name+bytes replays; different bytes conflict. */
  create(name: string, mimeType: 'application/gzip' | 'application/json', bytes: Uint8Array): Promise<string>;
  read(id: string): Promise<Uint8Array>;
}
export interface ContentRestoreBranch {
  readonly purpose: 'isolated-restore-branch';
  /** Refuse nonempty branch; restore atomically, defer lineage constraints,
   * reseed history/audit sequences, never invoke import or mutation RPCs. */
  restoreEmpty(snapshot: ContentBackupSnapshot, schemaVersion: number): Promise<void>;
  snapshot(): Promise<ContentBackupSnapshot>;
}
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const entrySchema = z.object({ id: z.string().min(1), name: z.string().regex(/^[a-z0-9-]+\.jsonl\.gz$/), rows: z.number().int().nonnegative(), bytes: z.number().int().nonnegative(), sha256: z.string().regex(/^[0-9a-f]{64}$/) }).strict();
const manifestSchema = z.object({ format: z.literal(1), schemaVersion: z.literal(CONTENT_STUDIO_SCHEMA_VERSION), backupId: z.string().uuid(), createdAt: z.string().datetime(),
  files: z.object(Object.fromEntries(BACKUP_TABLES.map(t => [t, entrySchema])) as Record<BackupTable, typeof entrySchema>).strict() }).strict();
export type BackupManifest = z.infer<typeof manifestSchema>;
export type VerifiedBackup = { manifestId: string; manifestHash: string; verifiedAt: number; manifest: BackupManifest };
export type BackupJournal = { lastVerified: VerifiedBackup | null; failureSince: number | null };
const invalid = () => new AppError('CONFLICT', { reason: 'backup_integrity' });

/** Stable row order makes branch parity independent of SELECT delivery order. */
export function backupParity(snapshot: ContentBackupSnapshot) {
  return Object.fromEntries(BACKUP_TABLES.map(table => {
    const rows = snapshot[table].map(row => canonicalJson(row)).sort();
    return [table, { count: rows.length, hash: mirrorHash(rows) }];
  })) as Record<BackupTable, { count: number; hash: string }>;
}

/** Always re-read manifest and ALL hashes before restore (stronger than the
 * design's one-file sampling minimum). No partial restore on corrupt input. */
export async function verifyContentBackup(folder: PrivateBackupFolder, manifestId: string, expectedManifestHash: string) {
  await folder.assertPrivate();
  const bytes = await folder.read(manifestId);
  if (digest(bytes) !== expectedManifestHash) throw invalid();
  const parsed = manifestSchema.safeParse(JSON.parse(Buffer.from(bytes).toString('utf8')));
  if (!parsed.success) throw invalid();
  const manifest = parsed.data;
  if (new Set(Object.values(manifest.files).map(f => f.id)).size !== BACKUP_TABLES.length) throw invalid();
  const snapshot = {} as ContentBackupSnapshot;
  for (const table of BACKUP_TABLES) {
    const file = manifest.files[table];
    if (file.name !== `${manifest.backupId}-${table.replaceAll('_', '-')}.jsonl.gz`) throw invalid();
    const compressed = await folder.read(file.id);
    if (compressed.byteLength !== file.bytes || digest(compressed) !== file.sha256) throw invalid();
    const text = gunzipSync(compressed, { maxOutputLength: 256 * 1024 * 1024 }).toString('utf8');
    if (text && !text.endsWith('\n')) throw invalid();
    const rows: unknown[] = text ? text.slice(0, -1).split('\n').map(line => JSON.parse(line)) : [];
    if (rows.length !== file.rows || rows.some(r => !r || typeof r !== 'object' || Array.isArray(r))) throw invalid();
    snapshot[table] = rows as Record<string, unknown>[];
  }
  return { manifest, snapshot };
}

export async function createContentBackup(source: ContentBackupSource, folder: PrivateBackupFolder, journal: BackupJournal, now = Date.now()) {
  try {
    await folder.assertPrivate();
    const snapshot = await source.snapshot(), backupId = randomUUID();
    const files = {} as BackupManifest['files'];
    for (const table of BACKUP_TABLES) {
      const rows = snapshot[table].map(row => canonicalJson(row)).sort();
      const bytes = gzipSync(rows.length ? `${rows.join('\n')}\n` : '');
      const name = `${backupId}-${table.replaceAll('_', '-')}.jsonl.gz`;
      files[table] = { name, id: await folder.create(name, 'application/gzip', bytes), rows: rows.length, bytes: bytes.length, sha256: digest(bytes) };
    }
    const manifest: BackupManifest = { format: 1, schemaVersion: CONTENT_STUDIO_SCHEMA_VERSION, backupId, createdAt: new Date(now).toISOString(), files };
    const bytes = Buffer.from(canonicalJson(manifest)), manifestHash = digest(bytes);
    const manifestId = await folder.create(`${backupId}-manifest.json`, 'application/json', bytes);
    await verifyContentBackup(folder, manifestId, manifestHash);
    journal.lastVerified = { manifestId, manifestHash, manifest, verifiedAt: now };
    journal.failureSince = null;
    return journal.lastVerified;
  } catch (error) { journal.failureSince ??= now; throw error; }
}

export async function restoreContentBackup(folder: PrivateBackupFolder, backup: Pick<VerifiedBackup, 'manifestId' | 'manifestHash'>, branch: ContentRestoreBranch) {
  if (branch.purpose !== 'isolated-restore-branch') throw new AppError('FORBIDDEN');
  const { manifest, snapshot } = await verifyContentBackup(folder, backup.manifestId, backup.manifestHash);
  await branch.restoreEmpty(snapshot, manifest.schemaVersion);
  const expected = backupParity(snapshot), actual = backupParity(await branch.snapshot());
  if (canonicalJson(expected) !== canonicalJson(actual)) throw new AppError('CONFLICT', { reason: 'restore_parity' });
  return { exact: true as const, manifestHash: backup.manifestHash, expected, actual };
}

/** Retain 30 daily snapshots, then the first completed snapshot in each Taipei
 * calendar month for twelve months. Returns IDs only; deletion is a separate
 * port operation and is deliberately not wired in this local-only build. */
export function retainedBackups(backups: VerifiedBackup[], now: number): string[] {
  const day = (time: number) => new Date(time + 8 * 3600_000).toISOString().slice(0, 10);
  const sorted = [...backups].filter(b => b.verifiedAt <= now).sort((a, b) => a.verifiedAt - b.verifiedAt);
  const firstByDay = new Map<string, VerifiedBackup>(), firstByMonth = new Map<string, VerifiedBackup>();
  for (const b of sorted) {
    const date = day(b.verifiedAt);
    if (!firstByDay.has(date)) firstByDay.set(date, b);
    if (!firstByMonth.has(date.slice(0, 7))) firstByMonth.set(date.slice(0, 7), b);
  }
  const currentMonth = new Date(now + 8 * 3600_000);
  const earliestMonth = new Date(Date.UTC(currentMonth.getUTCFullYear(), currentMonth.getUTCMonth() - 11, 1)).toISOString().slice(0, 7);
  const months = [...firstByMonth].filter(([month]) => month >= earliestMonth).map(([, backup]) => backup), daily = [...firstByDay.values()].slice(-30);
  return [...new Set([...daily, ...months].map(b => b.manifestId))];
}
