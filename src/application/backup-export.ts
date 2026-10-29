import 'server-only';
import { createGzip } from 'node:zlib';
import { createHash } from 'node:crypto';
import { AppError, isAppError } from '@/domain/errors';
import { BACKUP_MAX_BYTES } from '@/domain/weekly-backup';
import type { BackupRow, BackupRowSource } from './backup-ports';

/**
 * Full logical export of the owner's data (#249).
 *
 * One gzip JSON document: { format, createdAtUtc, tables: { name: [rows] }, manifest }.
 * The manifest is written LAST because it carries the per-table hashes, so the
 * file is produced in a single streaming pass: rows are read page by page
 * (keyset pagination on the primary key, never an offset), serialised straight
 * into the gzip stream and dropped. Memory holds one page plus the compressed
 * output, not the database.
 *
 * Never exported: auth tables, tokens, keys, the idempotency ledger, embeddings
 * and search indexes, image BYTES (ids + sha256 only), env values.
 */
export const BACKUP_FORMAT = 'content-studio-backup/1';
export const BACKUP_SCHEMA_VERSION = 2;

export type BackupTableSpec = {
  /** Section name in the file. */
  key: string;
  table: string;
  pk: readonly string[];
  select?: string;
  /** `latest`: newest N rows by primary key (bounded), with the real total in the manifest. */
  mode: 'full' | 'latest';
  limit?: 'history' | 'audit' | 'runs';
  /** A missing table is recorded, not fatal (an optional migration was never applied). */
  optional?: boolean;
  /** Restore order (parents first). */
  restoreOrder: number;
  /** False: informational only, restore skips this section. */
  restore: boolean;
};

export const BACKUP_TABLE_SPECS: readonly BackupTableSpec[] = [
  { key: 'posts', table: 'content_studio_posts', pk: ['collection', 'library_id'], mode: 'full', restoreOrder: 10, restore: true },
  { key: 'schedule', table: 'content_studio_schedule', pk: ['content_id'], mode: 'full', restoreOrder: 20, restore: true },
  { key: 'workflow_settings', table: 'content_studio_workflow_settings', pk: ['setting'], mode: 'full', restoreOrder: 30, restore: true },
  { key: 'schema_version', table: 'content_studio_schema_version', pk: ['singleton'], mode: 'full', restoreOrder: 0, restore: false },
  { key: 'row_history', table: 'content_studio_row_history', pk: ['history_id'], mode: 'latest', limit: 'history', restoreOrder: 40, restore: true },
  { key: 'audit_events', table: 'content_studio_audit_events', pk: ['event_id'], mode: 'latest', limit: 'audit', restoreOrder: 50, restore: true },
  { key: 'ai_budget', table: 'content_studio_ai_budget', pk: ['singleton'], mode: 'full', optional: true, restoreOrder: 60, restore: true },
  { key: 'ai_calls', table: 'content_studio_ai_calls', pk: ['id'], mode: 'full', optional: true, restoreOrder: 61, restore: true },
  { key: 'ai_cap_operations', table: 'content_studio_ai_cap_operations', pk: ['operation_id'], mode: 'full', optional: true, restoreOrder: 62, restore: true },
  { key: 'reply_settings', table: 'app_settings', pk: ['user_id'], mode: 'full', optional: true, restoreOrder: 70, restore: true },
  { key: 'reply_source_posts', table: 'source_posts', pk: ['id'], mode: 'full', optional: true, restoreOrder: 71, restore: true },
  { key: 'reply_resources', table: 'resources', pk: ['id'], mode: 'full', optional: true, restoreOrder: 72, restore: true },
  { key: 'reply_facts', table: 'facts', pk: ['id'], mode: 'full', optional: true, restoreOrder: 73, restore: true },
  { key: 'reply_sessions', table: 'reply_sessions', pk: ['id'], mode: 'full', optional: true, restoreOrder: 74, restore: true },
  { key: 'reply_generation_runs', table: 'generation_runs', pk: ['id'], mode: 'latest', limit: 'runs', optional: true, restoreOrder: 75, restore: true },
  { key: 'reply_suggestions', table: 'reply_suggestions', pk: ['id'], mode: 'full', optional: true, restoreOrder: 76, restore: true },
  { key: 'reply_library', table: 'reply_library', pk: ['id'], mode: 'full', optional: true, restoreOrder: 77, restore: true },
  { key: 'reply_revisions', table: 'reply_revisions', pk: ['id'], mode: 'full', optional: true, restoreOrder: 78, restore: true },
  // Metadata incl. sha256 only; the bytes table is listed by id so a restore can detect missing bytes.
  { key: 'reply_bank_images', table: 'reply_bank_images', pk: ['id'], mode: 'full', optional: true, restoreOrder: 79, restore: true },
  { key: 'reply_bank_image_files', table: 'reply_bank_image_files', pk: ['image_id'], select: 'image_id,user_id', mode: 'full', optional: true, restoreOrder: 80, restore: false },
];

export type BackupExportOptions = {
  pageSize?: number;
  historyLimit?: number;
  auditLimit?: number;
  runsLimit?: number;
  now: number;
  buildCommit: string | null;
  specs?: readonly BackupTableSpec[];
};

export type BackupManifestTable = {
  sourceTable: string;
  pk: readonly string[];
  rows: number;
  /** Real table size when the section is a bounded "latest N" slice. */
  totalRows: number | null;
  truncated: boolean;
  sha256: string;
  missing: boolean;
  restoreOrder: number;
  restore: boolean;
};
export type BackupManifest = {
  format: typeof BACKUP_FORMAT;
  schemaVersion: number;
  createdAtUtc: string;
  createdAtTaipei: string;
  buildCommit: string | null;
  tables: Record<string, BackupManifestTable>;
  totalRows: number;
};
export type BackupExport = { gz: Uint8Array; manifest: BackupManifest; sha256: string; md5: string };

const taipei = (at: number) => new Date(at + 8 * 3600_000).toISOString().replace('Z', '+08:00');

/** The hash of a section: sha256 over JSON.stringify(row) + newline for every row, in file order. */
export function sectionHash(rows: readonly unknown[]): string {
  const h = createHash('sha256');
  for (const row of rows) h.update(`${JSON.stringify(row)}\n`);
  return h.digest('hex');
}

function configuredLimit(spec: BackupTableSpec, o: BackupExportOptions): number {
  if (spec.mode === 'full') return Number.POSITIVE_INFINITY;
  const value = spec.limit === 'history' ? o.historyLimit : spec.limit === 'audit' ? o.auditLimit : o.runsLimit;
  return Math.max(1, value ?? 5000);
}

export async function exportBackup(source: BackupRowSource, options: BackupExportOptions): Promise<BackupExport> {
  const specs = options.specs ?? BACKUP_TABLE_SPECS;
  const pageSize = Math.min(1000, Math.max(1, options.pageSize ?? 500));
  const gzip = createGzip({ level: 6 });
  const chunks: Buffer[] = [];
  let size = 0;
  let failure: unknown = null;
  const done = new Promise<void>((resolve, reject) => {
    gzip.on('data', (c: Buffer) => {
      chunks.push(c);
      size += c.length;
      if (size > BACKUP_MAX_BYTES && !failure) { failure = new AppError('VALIDATION_FAILED', { reason: 'backup_too_large' }); gzip.destroy(); }
    });
    gzip.on('end', resolve);
    gzip.on('close', resolve);
    gzip.on('error', reject);
  });
  const write = async (text: string) => {
    if (failure) throw failure;
    if (!gzip.write(text)) await new Promise<void>(resolve => gzip.once('drain', resolve));
  };

  const manifestTables: Record<string, BackupManifestTable> = {};
  let totalRows = 0;
  try {
    await write(`{"format":${JSON.stringify(BACKUP_FORMAT)},"createdAtUtc":${JSON.stringify(new Date(options.now).toISOString())},"tables":{`);
    let firstTable = true;
    for (const spec of specs) {
      await write(`${firstTable ? '' : ','}${JSON.stringify(spec.key)}:[`);
      firstTable = false;
      const hash = createHash('sha256');
      const limit = configuredLimit(spec, options);
      let rows = 0, missing = false, truncated = false, total: number | null = null;
      let after: BackupRow | null = null;
      try {
        for (;;) {
          const want = Math.min(pageSize, limit - rows);
          if (want <= 0) break;
          const page: BackupRow[] = await source.page({ table: spec.table, ...(spec.select ? { select: spec.select } : {}), order: spec.pk, desc: spec.mode === 'latest', after, limit: want });
          if (page.length === 0) break;
          let text = '';
          for (const row of page) {
            const line = JSON.stringify(row);
            text += `${rows === 0 ? '' : ','}${line}`;
            hash.update(`${line}\n`);
            rows += 1;
          }
          await write(text);
          after = page[page.length - 1]!;
          if (page.length < want) break;
        }
        if (spec.mode === 'latest') {
          total = await source.count(spec.table).catch(() => null);
          truncated = total === null ? rows >= limit : total > rows;
        }
      } catch (error) {
        if (spec.optional && isAppError(error) && error.code === 'NOT_FOUND') missing = true;
        else throw error;
      }
      await write(']');
      manifestTables[spec.key] = { sourceTable: spec.table, pk: spec.pk, rows, totalRows: spec.mode === 'latest' ? total : rows, truncated, sha256: hash.digest('hex'), missing, restoreOrder: spec.restoreOrder, restore: spec.restore };
      totalRows += rows;
    }
    const manifest: BackupManifest = {
      format: BACKUP_FORMAT, schemaVersion: BACKUP_SCHEMA_VERSION, createdAtUtc: new Date(options.now).toISOString(), createdAtTaipei: taipei(options.now),
      buildCommit: options.buildCommit, tables: manifestTables, totalRows,
    };
    await write(`},"manifest":${JSON.stringify(manifest)}}`);
    gzip.end();
    await done;
    if (failure) throw failure;
    const gz = Buffer.concat(chunks);
    return { gz, manifest, sha256: createHash('sha256').update(gz).digest('hex'), md5: createHash('md5').update(gz).digest('hex') };
  } catch (error) {
    gzip.destroy();
    done.catch(() => undefined);
    throw error;
  }
}
