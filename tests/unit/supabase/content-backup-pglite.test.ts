import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase, type QueryRunner } from '../../replies/support/db';
import { BACKUP_TABLES, backupParity, createContentBackup, restoreContentBackup, verifyContentBackup, type ContentBackupSnapshot, type ContentRestoreBranch, type BackupJournal } from '@/application/content-backup';
import { FakePrivateBackupFolder } from '@/integrations/supabase/fake-content-backup';
import { buildTypedImport } from '@/application/content-import';
import { buildSheetMirrorSnapshot, mirrorHash } from '@/application/sheet-mirror';
import { FakeSheetTransport } from '@/integrations/google/fake-sheet';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';
import { CONTENT_STUDIO_SCHEMA_VERSION } from '@/integrations/supabase/content-schema';
import { SqlContentRestoreBranch, readContentBackupSnapshot } from '@/integrations/supabase/content-restore-branch';
import { FakeContentDb } from '@/integrations/supabase/fake-content-db';
import { SupabaseContentRepository } from '@/integrations/supabase/content-repository';
import { ContentExporter, ContentWriteCutover } from '@/application/content-export';
import type { ContentPostRow, ContentScheduleRow, ContentSettingRow } from '@/application/content-db';

let source: TestDatabase, branch: TestDatabase;
async function database() {
  const db = await createTestDatabase();
  for (const file of readdirSync('supabase/migrations').filter(f => /^\d+_content_.*\.sql$/.test(f)).sort()) await db.raw.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'));
  return db;
}
async function snapshot(q: QueryRunner): Promise<ContentBackupSnapshot> {
  return readContentBackupSnapshot(q);
}
const readSource = () => source.asService(snapshot);
const target: ContentRestoreBranch = new SqlContentRestoreBranch({ environment: 'isolated-restore-branch', transaction: run => branch.raw.transaction(run) });
beforeAll(async () => {
  source = await database(); branch = await database();
  vi.stubEnv('CS_CONTENT_STORE', 'db-shadow');
  try {
    const e = buildTypedImport(await buildSheetMirrorSnapshot(new SheetsContentRepository(new FakeSheetTransport()), { sourceKey: 'synthetic_workbook' }), new Map(), mirrorHash('synthetic-owner'));
    await source.asService(q => q.query('select content_studio_import_run($1,$2,$3,$4,$5,$6,$7)', [e.operationId, e.snapshotHash, e.actorHash, e.counts, e.hashes, e.exceptions, e.rows]));
  } finally { vi.unstubAllEnvs(); }
  await source.asService(q => q.query('select content_studio_apply_patch($1,$2,$3,$4,$5,$6,$7)', ['synthetic-backup-save', mirrorHash('synthetic patch'), mirrorHash('synthetic owner'), 'library', 'SYN-L001', 1, { draft_content: 'Synthetic backup copy\nwith trailing spaces  ' }]));
}, 120_000);
afterAll(async () => { await source?.close(); await branch?.close(); vi.unstubAllEnvs(); });

describe('MIG-13 private gzip history backup and restore branch parity under actual Postgres', () => {
  it('exports all six tables, verifies manifest/counts/compressed hashes, restores exact ledger/history/content and reseeds sequences', async () => {
    const folder = new FakePrivateBackupFolder(), journal: BackupJournal = { lastVerified: null, failureSince: null };
    const before = await readSource();
    expect(before.row_history.length).toBeGreaterThan(0); expect(before.operations.length).toBeGreaterThan(0); expect(before.audit_events.length).toBeGreaterThan(0);
    const backup = await createContentBackup({ snapshot: readSource }, folder, journal, 1_800_000_000_000);
    expect(folder.files.size).toBe(7); expect(journal.lastVerified).toEqual(backup);
    for (const table of BACKUP_TABLES) {
      const entry = backup.manifest.files[table], bytes = await folder.read(entry.id);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256);
      expect(entry.rows).toBe(before[table].length);
      const text = gunzipSync(bytes).toString(); expect(text.endsWith('\n')).toBe(true);
      expect(text.trimEnd().split('\n').map(line => JSON.parse(line))).toHaveLength(entry.rows);
    }
    const result = await restoreContentBackup(folder, backup, target);
    expect(result.exact).toBe(true); expect(result.actual).toEqual(backupParity(before));
    expect(await readSource()).toEqual(before); // source untouched by restore
    // Durable replay survives a restore without adding history/audit.
    const historyCount = (await target.snapshot()).row_history.length;
    const replay = await branch.asService(q => q.query<{ result: { ok: boolean; replayed: boolean } }>('select content_studio_apply_patch($1,$2,$3,$4,$5,$6,$7) as result', ['synthetic-backup-save', mirrorHash('synthetic patch'), mirrorHash('synthetic owner'), 'library', 'SYN-L001', 1, { draft_content: 'Synthetic backup copy\nwith trailing spaces  ' }]));
    expect(replay.rows[0]!.result).toMatchObject({ ok: true, replayed: true });
    expect((await target.snapshot()).row_history).toHaveLength(historyCount);
    const change = await branch.asService(q => q.query<{ result: { ok: boolean } }>('select content_studio_apply_patch($1,$2,$3,$4,$5,$6,$7) as result', ['synthetic-restored-edit', mirrorHash('restored patch'), mirrorHash('synthetic owner'), 'library', 'SYN-L001', 2, { draft_content: 'Synthetic restored branch edit' }]));
    expect(change.rows[0]!.result.ok).toBe(true);
    const restored = await target.snapshot();
    expect(restored.row_history).toHaveLength(historyCount + 1);
    expect(Number(restored.row_history.at(-1)!.history_id)).toBeGreaterThan(Math.max(...before.row_history.map(r => Number(r.history_id))));
    await expect(restoreContentBackup(folder, backup, target)).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'restore_branch_not_empty' } });
  });
  it.each(['manifest', 'posts', 'row_history', 'operations', 'audit_events'] as const)('refuses corrupted %s before making any branch write', async file => {
    const folder = new FakePrivateBackupFolder(), journal: BackupJournal = { lastVerified: null, failureSince: null };
    const backup = await createContentBackup({ snapshot: readSource }, folder, journal);
    const id = file === 'manifest' ? backup.manifestId : backup.manifest.files[file].id;
    const bytes = folder.files.get(id)!; bytes[0] = bytes[0]! ^ 1;
    const restoreEmpty = vi.fn();
    await expect(restoreContentBackup(folder, backup, { ...target, restoreEmpty })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(restoreEmpty).not.toHaveBeenCalled();
  });
  it('rejects a wrong count/schema or changed manifest and does not mark a failed upload verified', async () => {
    const folder = new FakePrivateBackupFolder(), journal: BackupJournal = { lastVerified: null, failureSince: null };
    const backup = await createContentBackup({ snapshot: readSource }, folder, journal);
    await expect(verifyContentBackup(folder, backup.manifestId, '0'.repeat(64))).rejects.toMatchObject({ code: 'CONFLICT' });
    for (const mutation of ['count', 'schema']) {
      const manifest: { schemaVersion: number; files: { posts: { rows: number } } } = structuredClone(backup.manifest);
      if (mutation === 'count') manifest.files.posts.rows++; else manifest.schemaVersion = CONTENT_STUDIO_SCHEMA_VERSION + 1;
      const bytes = Buffer.from(JSON.stringify(manifest)); folder.files.set(backup.manifestId, bytes);
      await expect(verifyContentBackup(folder, backup.manifestId, createHash('sha256').update(bytes).digest('hex'))).rejects.toMatchObject({ code: 'CONFLICT' });
    }
    const prior = structuredClone(journal.lastVerified);
    vi.spyOn(folder, 'create').mockRejectedValue(new Error('synthetic upload failure'));
    await expect(createContentBackup({ snapshot: readSource }, folder, journal, 1_800_000_000_000)).rejects.toThrow('upload failure');
    expect(journal.lastVerified).toEqual(prior); expect(journal.failureSince).toBe(1_800_000_000_000);
    folder.privateFolder = false;
    await expect(createContentBackup({ snapshot: readSource }, folder, journal)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('reports restore parity failure instead of a false green when the branch drops data', async () => {
    const folder = new FakePrivateBackupFolder(), journal: BackupJournal = { lastVerified: null, failureSince: null };
    const backup = await createContentBackup({ snapshot: readSource }, folder, journal);
    const data = structuredClone((await verifyContentBackup(folder, backup.manifestId, backup.manifestHash)).snapshot); data.posts.pop();
    await expect(restoreContentBackup(folder, backup, { purpose: 'isolated-restore-branch', restoreEmpty: async () => {}, snapshot: async () => data })).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'restore_parity' } });
  });
  it('rolls back the entire restore on a late audit constraint failure and refuses schema drift', async () => {
    await branch.raw.exec(`truncate ${BACKUP_TABLES.map(t => `content_studio_${t}`).join(',')} restart identity cascade`);
    const data = await readSource(); data.audit_events.push(structuredClone(data.audit_events[0]!));
    await expect(target.restoreEmpty(data, CONTENT_STUDIO_SCHEMA_VERSION)).rejects.toMatchObject({ code: '23505' });
    expect(Object.values(await target.snapshot()).every(rows => rows.length === 0)).toBe(true);
    await expect(target.restoreEmpty(data, CONTENT_STUDIO_SCHEMA_VERSION + 1)).rejects.toMatchObject({ code: 'SCHEMA_DRIFT' });
  });
  it('MIG-05/12 locally rehearses SQL authority -> exact Sheet export -> read-only -> exact final hashes -> Sheet flag', async () => {
    const facade = new FakeContentDb();
    const posts = async () => (await readSource()).posts as ContentPostRow[];
    vi.spyOn(facade, 'listPosts').mockImplementation(async c => (await posts()).filter(r => r.collection === c));
    vi.spyOn(facade, 'getPost').mockImplementation(async (c, id) => (await posts()).find(r => r.collection === c && r.library_id === id) ?? null);
    vi.spyOn(facade, 'listSchedule').mockImplementation(async () => (await readSource()).schedule as ContentScheduleRow[]);
    vi.spyOn(facade, 'workflowSettings').mockImplementation(async () => (await readSource()).workflow_settings as ContentSettingRow[]);
    const exporter = new ContentExporter(facade, new FakeSheetTransport(), { checkpoints: new Map(), issues: new Map(), reports: [] });
    const cutover = new ContentWriteCutover(new SupabaseContentRepository(facade), exporter);
    const original = await readSource(), flipped: string[] = [];
    const result = await cutover.rollbackToSheet(async mode => { flipped.push(mode); });
    expect(result.parity.exact).toBe(true); expect(result.parity.dbHash).toBe(result.parity.sheetHash); expect(flipped).toEqual(['sheet']);
    const row = await cutover.repo.getLibrary('SYN-L001');
    expect(await cutover.repo.updateLibrary({ operationId: 'synthetic-read-only-rehearsal', actor: { sub: 'synthetic-owner', role: 'owner' }, target: { libraryId: 'SYN-L001' }, expectedRevision: row.revision, patch: { draftContent: 'Synthetic refused write' } })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(await readSource()).toEqual(original);
    vi.restoreAllMocks();
  });
});
