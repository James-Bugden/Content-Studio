import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BACKUP_TABLE_SPECS, exportBackup } from '@/application/backup-export';
import { manifestFile } from '@/application/weekly-backup';
import { FakeBackupRowSource } from '@/integrations/supabase/fake-backup-source';
import { syntheticContentDbSeed } from '@/integrations/supabase/fake-content-db';
// @ts-expect-error plain ESM script without types
import { RestoreError, TABLES, applyBackup, main, summarize, validateBackup } from '../../scripts/restore-backup.mjs';

const NOW = Date.parse('2026-11-01T19:00:00Z');
const seed = syntheticContentDbSeed();
const sourceTables = () => ({
  content_studio_posts: seed.posts as unknown as Record<string, unknown>[],
  content_studio_schedule: seed.schedule as unknown as Record<string, unknown>[],
  content_studio_workflow_settings: seed.settings as unknown as Record<string, unknown>[],
  content_studio_schema_version: [{ singleton: true, version: 2 }],
  content_studio_row_history: [],
  content_studio_audit_events: [],
  reply_bank_images: [{ id: 'img-1', status: 'ready', sha256: 'a'.repeat(64) }, { id: 'img-2', status: 'ready', sha256: 'b'.repeat(64) }],
  reply_bank_image_files: [{ image_id: 'img-1', user_id: 'u' }],
});
let dir: string, gzPath: string, sidecarPath: string, gz: Uint8Array, sidecar: string;
beforeAll(async () => {
  const out = await exportBackup(new FakeBackupRowSource(sourceTables()), { now: NOW, buildCommit: 'abc1234' });
  gz = out.gz;
  sidecar = Buffer.from(manifestFile(out, 'content-studio-backup-2026-11-02-0300.json.gz')).toString('utf8');
  dir = mkdtempSync(join(tmpdir(), 'cs-restore-'));
  gzPath = join(dir, 'content-studio-backup-2026-11-02-0300.json.gz');
  sidecarPath = join(dir, 'content-studio-backup-2026-11-02-0300.manifest.json');
  writeFileSync(gzPath, gz);
  writeFileSync(sidecarPath, sidecar);
});

const regzip = (edit: (doc: any) => void) => { const doc = JSON.parse(gunzipSync(gz).toString('utf8')); edit(doc); return gzipSync(JSON.stringify(doc)); }; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('the script allow-list matches the exporter', () => {
  it('has the same tables, keys, restore order and restore flag', () => {
    expect(Object.keys(TABLES).sort()).toEqual(BACKUP_TABLE_SPECS.map(s => s.key).sort());
    for (const s of BACKUP_TABLE_SPECS) {
      expect(TABLES[s.key]).toMatchObject({ table: s.table, pk: [...s.pk], order: s.restoreOrder, restore: s.restore });
    }
  });
});

describe('validation', () => {
  it('accepts a good file, with and without the sidecar manifest', () => {
    expect(validateBackup(gz).manifest.totalRows).toBeGreaterThan(0);
    expect(() => validateBackup(gz, sidecar)).not.toThrow();
  });
  it('rejects garbage, a wrong format and a missing manifest', () => {
    expect(() => validateBackup(new Uint8Array([1, 2, 3]))).toThrow(RestoreError);
    expect(() => validateBackup(gzipSync('{"format":"other"}'))).toThrow(/Unrecognised/);
    expect(() => validateBackup(regzip(d => { delete d.manifest; }))).toThrow(/Unrecognised/);
  });
  it('detects an edited row (checksum), a dropped row (count) and a changed total', () => {
    expect(() => validateBackup(regzip(d => { d.tables.posts[0].title = 'tampered'; }))).toThrow(/checksum/);
    expect(() => validateBackup(regzip(d => { d.tables.posts.pop(); }))).toThrow(/row count/);
    expect(() => validateBackup(regzip(d => { d.manifest.totalRows += 1; }))).toThrow(/Total row count/);
  });
  it('rejects an unknown table or a table/key outside the allow-list', () => {
    expect(() => validateBackup(regzip(d => { d.tables.evil = []; d.manifest.tables.evil = { ...d.manifest.tables.posts, rows: 0 }; }))).toThrow(/Unknown table/);
    expect(() => validateBackup(regzip(d => { d.manifest.tables.posts.sourceTable = 'auth.users'; }))).toThrow(/allowed table/);
    expect(() => validateBackup(regzip(d => { d.manifest.tables.posts.pk = ['id']; }))).toThrow(/allowed table/);
  });
  it('rejects a data file that does not match its sidecar manifest', () => {
    expect(() => validateBackup(gz, sidecar.replace(/"sha256": "[0-9a-f]{64}"/, `"sha256": "${'0'.repeat(64)}"`))).toThrow(/sidecar|checksum in its/);
    expect(() => validateBackup(gzipSync('x'), sidecar)).toThrow(RestoreError);
  });
});

describe('dry run (the default)', () => {
  it('prints row counts per table and changes nothing', async () => {
    const lines: string[] = [];
    const connect = vi.fn();
    const result = await main([gzPath, '--manifest', sidecarPath], { RESTORE_DATABASE_URL: 'postgres://synthetic' }, (l: string) => lines.push(l), connect);
    expect(result).toEqual({ applied: false });
    expect(connect).not.toHaveBeenCalled();
    const text = lines.join('\n');
    expect(text).toContain('Checksums and row counts verified.');
    expect(text).toMatch(new RegExp(`posts\\s+${seed.posts.length} rows`));
    expect(text).toMatch(new RegExp(`schedule\\s+${seed.schedule.length} rows`));
    expect(text).toContain('Dry run only');
    expect(text).not.toContain('postgres://');
  });
  it('flags image bytes that were never in the backup', () => {
    const s = summarize(validateBackup(gz));
    expect(s.imagesNeedingBytes).toBe(2);
    expect(s.imagesMissingBytesAtBackup).toBe(1);
  });
});

describe('apply guards', () => {
  it('--apply alone, or without a database URL, changes nothing', async () => {
    const connect = vi.fn();
    await expect(main([gzPath, '--apply'], { RESTORE_DATABASE_URL: 'postgres://synthetic' }, () => {}, connect)).rejects.toThrow(/--confirm/);
    await expect(main([gzPath, '--apply', '--confirm'], {}, () => {}, connect)).rejects.toThrow(/RESTORE_DATABASE_URL/);
    expect(connect).not.toHaveBeenCalled();
  });
  it('refuses to apply a corrupt file before connecting', async () => {
    const bad = join(dir, 'bad.json.gz');
    writeFileSync(bad, regzip(d => { d.tables.posts[0].title = 'x'; }));
    const connect = vi.fn();
    await expect(main([bad, '--apply', '--confirm'], { RESTORE_DATABASE_URL: 'postgres://synthetic' }, () => {}, connect)).rejects.toThrow(RestoreError);
    expect(connect).not.toHaveBeenCalled();
  });
  it('rejects unknown flags (the URL can never be passed as an argument)', async () => {
    await expect(main([gzPath, '--database-url', 'postgres://x'], {}, () => {})).rejects.toThrow(/Unknown argument/);
  });
  it('with both flags and a URL it connects with the env value and upserts parents first', async () => {
    const queries: string[] = [];
    const client = { query: vi.fn(async (sql: string) => { queries.push(sql); return { rows: [] }; }), end: vi.fn() };
    const connect = vi.fn(async () => client);
    const result = await main([gzPath, '--apply', '--confirm'], { RESTORE_DATABASE_URL: 'postgres://synthetic-target' }, () => {}, connect);
    expect(result).toEqual({ applied: true });
    expect(connect).toHaveBeenCalledWith('postgres://synthetic-target');
    const tables = queries.filter(q => q.startsWith('insert into')).map(q => /public\."([a-z_]+)"/.exec(q)![1]);
    expect(tables.indexOf('content_studio_posts')).toBeLessThan(tables.indexOf('content_studio_schedule'));
    expect(tables).not.toContain('content_studio_schema_version');
    expect(tables).not.toContain('reply_bank_image_files');
    expect(queries.filter(q => q === 'begin')).toHaveLength(queries.filter(q => q === 'commit').length);
    expect(client.end).toHaveBeenCalled();
  });
  it('rolls the failing table back and stops', async () => {
    const queries: string[] = [];
    const client = { query: vi.fn(async (sql: string) => { queries.push(sql); if (sql.includes('"content_studio_schedule"')) throw Object.assign(new Error('secret detail'), { code: '23503' }); return { rows: [] }; }) };
    const doc = validateBackup(gz);
    const err = await applyBackup(client, doc).catch((e: Error) => e);
    expect(err).toBeInstanceOf(RestoreError);
    expect((err as Error).message).toContain('rolled back');
    expect((err as Error).message).not.toContain('secret detail');
    expect(queries).toContain('rollback');
    expect(queries.some(q => q.includes('"content_studio_workflow_settings"'))).toBe(false);
  });
});

describe('real SQL round trip (PGlite with the app migrations)', () => {
  const FILES = ['20261024000100_content_authority.sql', '20261024000200_content_summary_reads.sql', '20261025000100_content_writes.sql', '20261025000400_content_markdown_export.sql',
    '20261027000200_post_versions_and_soft_delete.sql', '20261027000300_ai_usage.sql', '20261027000400_image_pipeline.sql', '20261027000500_content_summary_without_copyright.sql',
    '20261028000200_image_sketch_options.sql'];
  let pg: PGlite;
  beforeAll(async () => {
    pg = await PGlite.create();
    await pg.exec('create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon, authenticated, service_role;');
    for (const f of FILES) await pg.exec(readFileSync(`supabase/migrations/${f}`, 'utf8'));
  }, 120_000);
  afterAll(async () => { await pg?.close(); });

  it('restores posts, schedule and settings exactly, and is safe to run twice', async () => {
    const doc = validateBackup(gz);
    delete doc.tables.reply_bank_images; // the reply tables belong to other migrations, not applied in this database
    const client = { query: (sql: string, params?: unknown[]) => pg.query(sql, params) };
    await applyBackup(client, doc);
    await applyBackup(client, doc);
    const count = async (t: string) => Number((await pg.query<{ n: number }>(`select count(*)::int n from ${t}`)).rows[0]!.n);
    expect(await count('content_studio_posts')).toBe(seed.posts.length);
    expect(await count('content_studio_schedule')).toBe(seed.schedule.length);
    expect(await count('content_studio_workflow_settings')).toBe(seed.settings.length);
    const first = seed.posts[0]!;
    const row = (await pg.query<{ r: Record<string, unknown> }>('select to_jsonb(p) r from content_studio_posts p where collection = $1 and library_id = $2', [first.collection, first.library_id])).rows[0]!.r;
    expect(row).toMatchObject({ collection: first.collection, library_id: first.library_id, source_sheet_row: first.source_sheet_row, sheet_revision: first.sheet_revision });
  });
});
