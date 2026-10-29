import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BACKUP_TABLE_SPECS, exportBackup, sectionHash, type BackupTableSpec } from '@/application/backup-export';
import { FakeBackupRowSource } from '@/integrations/supabase/fake-backup-source';
import { AppError } from '@/domain/errors';

const NOW = Date.parse('2026-11-01T19:00:00Z');
const specs: BackupTableSpec[] = [
  { key: 'posts', table: 'p', pk: ['collection', 'library_id'], mode: 'full', restoreOrder: 1, restore: true },
  { key: 'history', table: 'h', pk: ['history_id'], mode: 'latest', limit: 'history', restoreOrder: 2, restore: true },
  { key: 'optional', table: 'gone', pk: ['id'], mode: 'full', optional: true, restoreOrder: 3, restore: true },
  { key: 'files', table: 'f', pk: ['image_id'], select: 'image_id', mode: 'full', restoreOrder: 4, restore: false },
];
const posts = Array.from({ length: 7 }, (_, i) => ({ collection: i % 2 ? 'b' : 'a', library_id: `L${String(i).padStart(2, '0')}`, title: `T${i}`, image_sketch: null }));
const tables = () => ({
  p: posts,
  h: Array.from({ length: 12 }, (_, i) => ({ history_id: i + 1 })),
  f: [{ image_id: 'i1', secret_bytes: 'x' }, { image_id: 'i2', secret_bytes: 'y' }],
});
const parse = (gz: Uint8Array) => JSON.parse(gunzipSync(gz).toString('utf8'));

describe('chunked export', () => {
  it('reads in bounded keyset pages, never offset, and every page respects the page size', async () => {
    const source = new FakeBackupRowSource(tables());
    const out = await exportBackup(source, { now: NOW, buildCommit: 'abc1234', specs, pageSize: 3 });
    const postPages = source.pages.filter(p => p.table === 'p');
    expect(postPages.map(p => p.limit)).toEqual([3, 3, 3]);
    expect(postPages[0]!.after).toBeNull();
    expect(postPages[1]!.after).toEqual(expect.objectContaining({ collection: 'a', library_id: 'L04' }));
    expect(source.pages.every(p => p.limit <= 3)).toBe(true);
    const doc = parse(out.gz);
    expect(doc.tables.posts).toHaveLength(7);
    expect(new Set(doc.tables.posts.map((r: { library_id: string }) => r.library_id))).toEqual(new Set(posts.map(r => r.library_id)));
  });
  it('writes a manifest with counts, section hashes, build and both timestamps', async () => {
    const out = await exportBackup(new FakeBackupRowSource(tables()), { now: NOW, buildCommit: 'abc1234', specs, pageSize: 4 });
    const doc = parse(out.gz);
    expect(doc.manifest).toEqual(JSON.parse(JSON.stringify(out.manifest)));
    expect(doc.manifest.buildCommit).toBe('abc1234');
    expect(doc.manifest.createdAtUtc).toBe('2026-11-01T19:00:00.000Z');
    expect(doc.manifest.createdAtTaipei).toBe('2026-11-02T03:00:00.000+08:00');
    expect(doc.manifest.tables.posts).toMatchObject({ sourceTable: 'p', rows: 7, totalRows: 7, truncated: false, missing: false });
    for (const [key, entry] of Object.entries(doc.manifest.tables) as [string, { sha256: string; rows: number }][]) {
      expect(sectionHash(doc.tables[key])).toBe(entry.sha256);
      expect(doc.tables[key]).toHaveLength(entry.rows);
    }
    expect(doc.manifest.totalRows).toBe(7 + 12 + 0 + 2);
  });
  it('checksums the gzip bytes', async () => {
    const out = await exportBackup(new FakeBackupRowSource(tables()), { now: NOW, buildCommit: null, specs });
    expect(out.sha256).toBe(createHash('sha256').update(out.gz).digest('hex'));
    expect(out.md5).toBe(createHash('md5').update(out.gz).digest('hex'));
  });
  it('bounds a "latest" table to newest N and records the true total', async () => {
    const out = await exportBackup(new FakeBackupRowSource(tables()), { now: NOW, buildCommit: null, specs, historyLimit: 5, pageSize: 2 });
    const doc = parse(out.gz);
    expect(doc.tables.history.map((r: { history_id: number }) => r.history_id)).toEqual([12, 11, 10, 9, 8]);
    expect(doc.manifest.tables.history).toMatchObject({ rows: 5, totalRows: 12, truncated: true });
  });
  it('records a missing optional table instead of failing, but fails on a missing required one', async () => {
    const out = await exportBackup(new FakeBackupRowSource(tables()), { now: NOW, buildCommit: null, specs });
    expect(parse(out.gz).manifest.tables.optional).toMatchObject({ missing: true, rows: 0 });
    const data: Record<string, Record<string, unknown>[]> = tables();
    delete data.p;
    await expect(exportBackup(new FakeBackupRowSource(data), { now: NOW, buildCommit: null, specs })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('lists image files by id only (select restricts columns)', async () => {
    const doc = parse((await exportBackup(new FakeBackupRowSource(tables()), { now: NOW, buildCommit: null, specs })).gz);
    expect(doc.tables.files).toEqual([{ image_id: 'i1' }, { image_id: 'i2' }]);
    expect(JSON.stringify(doc)).not.toContain('secret_bytes');
  });
  it('propagates a provider failure mid-export', async () => {
    const source = new FakeBackupRowSource(tables());
    source.failAtPage = 2;
    await expect(exportBackup(source, { now: NOW, buildCommit: null, specs, pageSize: 2 })).rejects.toBeInstanceOf(AppError);
  });
  it('covers every required data area and never an auth or secret table', () => {
    const names = BACKUP_TABLE_SPECS.map(s => s.table);
    for (const t of ['content_studio_posts', 'content_studio_schedule', 'content_studio_workflow_settings', 'content_studio_ai_calls', 'content_studio_ai_budget', 'content_studio_row_history', 'content_studio_audit_events', 'reply_bank_images', 'reply_sessions', 'facts', 'resources']) expect(names).toContain(t);
    expect(names.some(t => /auth|token|secret|key|password/i.test(t))).toBe(false);
  });
});
