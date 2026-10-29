#!/usr/bin/env node
// Restore a Content Studio weekly backup (#249). See docs/ops/backup-and-restore.md.
//
//   node scripts/restore-backup.mjs <file.json.gz> [--manifest <file.manifest.json>]
//       Validates the file and prints a dry-run summary. Changes nothing.
//   RESTORE_DATABASE_URL=... node scripts/restore-backup.mjs <file.json.gz> --apply --confirm
//       Upserts rows table by table (parents first), one transaction per table.
//
// The database URL is read from the environment at run time only; it is never
// accepted as an argument, printed or written anywhere.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';

export const FORMAT = 'content-studio-backup/1';
const MAX_UNZIPPED = 1024 * 1024 * 1024;
const IDENT = /^[a-z][a-z0-9_]{0,62}$/;
const CHUNK = 200;

/** Must equal BACKUP_TABLE_SPECS in src/application/backup-export.ts (a unit test enforces it). */
export const TABLES = {
  posts: { table: 'content_studio_posts', pk: ['collection', 'library_id'], order: 10, restore: true },
  schedule: { table: 'content_studio_schedule', pk: ['content_id'], order: 20, restore: true },
  workflow_settings: { table: 'content_studio_workflow_settings', pk: ['setting'], order: 30, restore: true },
  schema_version: { table: 'content_studio_schema_version', pk: ['singleton'], order: 0, restore: false },
  row_history: { table: 'content_studio_row_history', pk: ['history_id'], order: 40, restore: true, serial: 'history_id' },
  audit_events: { table: 'content_studio_audit_events', pk: ['event_id'], order: 50, restore: true, serial: 'event_id' },
  ai_budget: { table: 'content_studio_ai_budget', pk: ['singleton'], order: 60, restore: true },
  ai_calls: { table: 'content_studio_ai_calls', pk: ['id'], order: 61, restore: true },
  ai_cap_operations: { table: 'content_studio_ai_cap_operations', pk: ['operation_id'], order: 62, restore: true },
  reply_settings: { table: 'app_settings', pk: ['user_id'], order: 70, restore: true },
  reply_source_posts: { table: 'source_posts', pk: ['id'], order: 71, restore: true },
  reply_resources: { table: 'resources', pk: ['id'], order: 72, restore: true },
  reply_facts: { table: 'facts', pk: ['id'], order: 73, restore: true },
  reply_sessions: { table: 'reply_sessions', pk: ['id'], order: 74, restore: true },
  reply_generation_runs: { table: 'generation_runs', pk: ['id'], order: 75, restore: true },
  reply_suggestions: { table: 'reply_suggestions', pk: ['id'], order: 76, restore: true },
  reply_library: { table: 'reply_library', pk: ['id'], order: 77, restore: true },
  reply_revisions: { table: 'reply_revisions', pk: ['id'], order: 78, restore: true },
  reply_bank_images: { table: 'reply_bank_images', pk: ['id'], order: 79, restore: true },
  reply_bank_image_files: { table: 'reply_bank_image_files', pk: ['image_id'], order: 80, restore: false },
};

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export class RestoreError extends Error {}
const fail = (message) => { throw new RestoreError(message); };

/** sha256 over JSON.stringify(row) + newline for each row, same as the exporter. */
export function sectionHash(rows) {
  const h = createHash('sha256');
  for (const row of rows) h.update(`${JSON.stringify(row)}\n`);
  return h.digest('hex');
}

/**
 * Parse and fully validate a backup. Throws RestoreError on any mismatch:
 * format, per-table row counts and sha256, unknown or missing sections,
 * a table/primary key outside the allow-list, and (optionally) the sidecar
 * manifest's checksum of the .json.gz bytes.
 */
export function validateBackup(gzBytes, sidecarText) {
  let doc;
  try { doc = JSON.parse(gunzipSync(gzBytes, { maxOutputLength: MAX_UNZIPPED }).toString('utf8')); }
  catch { fail('Not a readable gzip JSON backup.'); }
  if (!doc || doc.format !== FORMAT || !doc.manifest || typeof doc.tables !== 'object' || doc.tables === null) fail('Unrecognised backup format.');
  const m = doc.manifest;
  if (m.format !== FORMAT || typeof m.tables !== 'object' || m.tables === null) fail('Manifest is missing or invalid.');
  const sections = Object.keys(doc.tables).sort(), declared = Object.keys(m.tables).sort();
  if (JSON.stringify(sections) !== JSON.stringify(declared)) fail('Manifest and data list different tables.');
  let total = 0;
  for (const key of sections) {
    const known = TABLES[key], entry = m.tables[key], rows = doc.tables[key];
    if (!known) fail(`Unknown table section "${key}".`);
    if (entry.sourceTable !== known.table || JSON.stringify(entry.pk) !== JSON.stringify(known.pk)) fail(`Section "${key}" does not match the allowed table or key.`);
    if (!Array.isArray(rows) || rows.length !== entry.rows) fail(`Section "${key}": row count does not match the manifest.`);
    if (sectionHash(rows) !== entry.sha256) fail(`Section "${key}": checksum does not match the manifest (file is corrupt or edited).`);
    total += rows.length;
  }
  if (total !== m.totalRows) fail('Total row count does not match the manifest.');
  if (sidecarText !== undefined) {
    let side;
    try { side = JSON.parse(sidecarText); } catch { fail('The .manifest.json file is not valid JSON.'); }
    if (!side.file || side.file.sha256 !== sha256(gzBytes) || side.file.bytes !== gzBytes.length) fail('The .json.gz does not match the checksum in its .manifest.json.');
    for (const key of sections) if (side.tables?.[key]?.sha256 !== m.tables[key].sha256) fail(`Section "${key}" differs between the sidecar manifest and the backup.`);
  }
  return doc;
}

/** Lines for the dry-run report: one per table with its row count and any caveat. */
export function summarize(doc) {
  const m = doc.manifest;
  const lines = Object.keys(doc.tables).sort((a, b) => TABLES[a].order - TABLES[b].order).map((key) => {
    const e = m.tables[key];
    const notes = [e.missing ? 'table was missing at backup time' : '', e.truncated ? `latest slice of ${e.totalRows ?? '?'} rows` : '', TABLES[key].restore ? '' : 'informational, not restored'].filter(Boolean);
    return `${key.padEnd(24)} ${String(e.rows).padStart(8)} rows  -> ${TABLES[key].table}${notes.length ? `  (${notes.join('; ')})` : ''}`;
  });
  const images = doc.tables.reply_bank_images ?? [], files = new Set((doc.tables.reply_bank_image_files ?? []).map((r) => r.image_id));
  const missingBytes = images.filter((r) => r.status === 'ready' && !files.has(r.id)).length;
  return { lines, totalRows: m.totalRows, createdAtUtc: m.createdAtUtc, createdAtTaipei: m.createdAtTaipei, buildCommit: m.buildCommit ?? null,
    imagesNeedingBytes: images.filter((r) => r.status === 'ready').length, imagesMissingBytesAtBackup: missingBytes };
}

/**
 * Upsert every restorable table, parents first, one transaction per table.
 * `client.query(sql, params)` is the only thing needed (pg Client, PGlite, a fake).
 */
export async function applyBackup(client, doc, log = () => {}) {
  const order = Object.keys(doc.tables).filter((k) => TABLES[k].restore).sort((a, b) => TABLES[a].order - TABLES[b].order);
  const done = [];
  for (const key of order) {
    const { table, pk, serial } = TABLES[key], rows = doc.tables[key];
    if (!rows.length) continue;
    const cols = Object.keys(rows[0]);
    if (!IDENT.test(table) || !cols.every((c) => IDENT.test(c)) || !pk.every((c) => cols.includes(c))) fail(`Refusing to restore "${key}": unexpected columns.`);
    for (const row of rows) if (Object.keys(row).length !== cols.length || !cols.every((c) => Object.hasOwn(row, c))) fail(`Refusing to restore "${key}": rows have different columns.`);
    const list = cols.map((c) => `"${c}"`).join(', ');
    const set = cols.filter((c) => !pk.includes(c)).map((c) => `"${c}" = excluded."${c}"`).join(', ');
    const sql = `insert into public."${table}" (${list}) select ${list} from jsonb_populate_recordset(null::public."${table}", $1::jsonb) on conflict (${pk.map((c) => `"${c}"`).join(', ')}) ${set ? `do update set ${set}` : 'do nothing'}`;
    await client.query('begin');
    try {
      for (let i = 0; i < rows.length; i += CHUNK) await client.query(sql, [JSON.stringify(rows.slice(i, i + CHUNK))]);
      if (serial) await client.query(`select setval(pg_get_serial_sequence('public.${table}', '${serial}'), greatest((select coalesce(max("${serial}"), 1) from public."${table}"), 1))`);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw new RestoreError(`Restore of "${key}" failed and was rolled back (${error?.code ?? 'error'}). Tables restored before it stay restored.`);
    }
    done.push({ key, rows: rows.length });
    log(`restored ${key}: ${rows.length} rows`);
  }
  return done;
}

function parseArgs(argv) {
  const out = { file: undefined, manifest: undefined, apply: false, confirm: false };
  const args = [...argv];
  while (args.length) {
    const a = args.shift();
    if (a === '--apply') out.apply = true;
    else if (a === '--confirm') out.confirm = true;
    else if (a === '--manifest') out.manifest = args.shift();
    else if (!a.startsWith('--') && !out.file) out.file = a;
    else fail(`Unknown argument: ${a.startsWith('--') ? a : '(extra file)'}`);
  }
  if (!out.file) fail('Usage: node scripts/restore-backup.mjs <file.json.gz> [--manifest <file>] [--apply --confirm]');
  return out;
}

export async function main(argv, env = process.env, out = console.log, connect) {
  const args = parseArgs(argv);
  const gz = readFileSync(args.file);
  const doc = validateBackup(gz, args.manifest ? readFileSync(args.manifest, 'utf8') : undefined);
  const s = summarize(doc);
  out(`Backup created ${s.createdAtTaipei} (UTC ${s.createdAtUtc}), build ${s.buildCommit ?? 'unknown'}`);
  out('Checksums and row counts verified.');
  s.lines.forEach((l) => out(l));
  out(`Total: ${s.totalRows} rows. Reply bank images listed: ${s.imagesNeedingBytes} (image bytes are NOT in this backup).`);
  if (!args.apply) { out('Dry run only: nothing was changed. Add --apply --confirm to restore.'); return { applied: false }; }
  if (!args.confirm) fail('--apply needs --confirm as well. Nothing was changed.');
  const url = env.RESTORE_DATABASE_URL;
  if (!url) fail('Set RESTORE_DATABASE_URL in the environment to the target database. Nothing was changed.');
  const client = connect ? await connect(url) : await defaultConnect(url);
  try { await applyBackup(client, doc, out); } finally { await client.end?.(); }
  out('Restore finished.');
  return { applied: true };
}

async function defaultConnect(url) {
  let pg;
  try { pg = await import('pg'); } catch { fail('The "pg" package is needed to apply a restore. Install it once with: npm install --no-save pg'); }
  const Client = pg.Client ?? pg.default?.Client;
  const client = new Client({ connectionString: url });
  await client.connect();
  return client;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof RestoreError ? error.message : 'Restore failed unexpectedly.');
    process.exit(1);
  });
}
