import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AppError } from '@/domain/errors';
import { FakeSheetTransport } from '@/integrations/google/fake-sheet';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';
import { SupabaseSheetMirrorStore } from '@/integrations/supabase/sheet-mirror-store';
import {
  buildSheetMirrorSnapshot,
  mirrorHash,
  type MirrorApplyResult,
  type MirrorRow,
  type SheetMirrorSnapshot,
  type SheetMirrorStore,
} from '@/application/sheet-mirror';

const sourceKey = 'synthetic_workbook';
const runOne = '11111111-1111-4111-8111-111111111111';
const runTwo = '22222222-2222-4222-8222-222222222222';

class MemoryStore implements SheetMirrorStore {
  private readonly runs = new Map<string, MirrorApplyResult>();
  private readonly active = new Map<string, MirrorRow>();

  async applySnapshot(snapshot: SheetMirrorSnapshot): Promise<MirrorApplyResult> {
    const existing = this.runs.get(snapshot.runId);
    if (existing) {
      if (existing.snapshotHash !== snapshot.snapshotHash) throw new AppError('CONFLICT');
      return { ...existing, replayed: true };
    }
    const before = new Set([...this.active.keys()].filter((key) => key.startsWith(`${snapshot.sourceKey}\u0000`)));
    for (const item of snapshot.rows) {
      const key = `${snapshot.sourceKey}\u0000${item.collection}\u0000${item.stableId}`;
      this.active.set(key, item);
      before.delete(key);
    }
    for (const key of before) this.active.delete(key);
    const result = { runId: snapshot.runId, snapshotHash: snapshot.snapshotHash, replayed: false, upserted: snapshot.rows.length, retired: before.size };
    this.runs.set(snapshot.runId, result);
    return result;
  }

  async readActive(key: string): Promise<MirrorRow[]> {
    return [...this.active.entries()]
      .filter(([id]) => id.startsWith(`${key}\u0000`))
      .map(([, item]) => item)
      .sort((a, b) => a.collection.localeCompare(b.collection) || a.stableId.localeCompare(b.stableId));
  }
}

describe('MIG-02: exact Sheet snapshot and replay', () => {
  it('uses a content-sensitive SHA-256 hash rather than a constant or short change fingerprint', () => {
    expect(mirrorHash({ value: 'A' })).toMatch(/^[0-9a-f]{64}$/);
    expect(mirrorHash({ value: 'A' })).not.toBe(mirrorHash({ value: 'B' }));
    expect(mirrorHash({ b: 2, a: 1 })).toBe(mirrorHash({ a: 1, b: 2 }));
  });

  it('preserves every collection, stable ID, exact payload, revision and deterministic hash', async () => {
    const repo = new SheetsContentRepository(new FakeSheetTransport());
    const snapshot = await buildSheetMirrorSnapshot(repo, { sourceKey, runId: runOne, startedAt: new Date('2026-09-25T00:00:00.000Z') });
    const total = Object.values(snapshot.counts).reduce((sum, count) => sum + count, 0);
    expect(total).toBe(snapshot.rows.length);
    expect(snapshot.counts.schema).toBe(1);
    expect(snapshot.counts.workflow_settings).toBe(1);
    expect(snapshot.counts.library).toBeGreaterThan(0);
    expect(snapshot.counts.schedule).toBeGreaterThan(0);

    const source = await repo.getLibrary('SYN-L008');
    const mirrored = snapshot.rows.find((item) => item.collection === 'library' && item.stableId === 'SYN-L008');
    expect(mirrored).toMatchObject({ sourceRow: source.row, sourceRevision: source.revision, payload: source });
    expect(mirrored?.rowHash).toBe(mirrorHash(source));

    const rebuilt = await buildSheetMirrorSnapshot(repo, { sourceKey, runId: runTwo, startedAt: new Date('2026-09-25T00:01:00.000Z') });
    expect(rebuilt.snapshotHash).toBe(snapshot.snapshotHash);
    expect(rebuilt.rows).toEqual(snapshot.rows);
  });

  it('replays the same run without duplicating rows and retires only after a complete next snapshot', async () => {
    const snapshot = await buildSheetMirrorSnapshot(new SheetsContentRepository(new FakeSheetTransport()), { sourceKey, runId: runOne });
    const store = new MemoryStore();
    expect(await store.applySnapshot(snapshot)).toMatchObject({ replayed: false, upserted: snapshot.rows.length, retired: 0 });
    expect(await store.applySnapshot(snapshot)).toMatchObject({ replayed: true, upserted: snapshot.rows.length, retired: 0 });
    expect(await store.readActive(sourceKey)).toHaveLength(snapshot.rows.length);

    const removed = snapshot.rows.find((item) => item.collection === 'library')!;
    const nextRows = snapshot.rows.filter((item) => item !== removed);
    const next: SheetMirrorSnapshot = {
      ...snapshot,
      runId: runTwo,
      rows: nextRows,
      counts: { ...snapshot.counts, library: snapshot.counts.library - 1 },
      snapshotHash: mirrorHash(nextRows.map(({ collection, stableId, rowHash }) => ({ collection, stableId, rowHash }))),
    };
    expect(await store.applySnapshot(next)).toMatchObject({ replayed: false, retired: 1 });
    expect((await store.readActive(sourceKey)).some((item) => item.collection === removed.collection && item.stableId === removed.stableId)).toBe(false);
  });

  it('rejects a duplicate stable ID before any store write', async () => {
    const repo = new SheetsContentRepository(new FakeSheetTransport());
    const original = repo.listLibrary.bind(repo);
    repo.listLibrary = async () => {
      const rows = await original();
      return [...rows, rows[0]!];
    };
    await expect(buildSheetMirrorSnapshot(repo, { sourceKey, runId: runOne })).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('MIG-04: server-only Supabase boundary', () => {
  it('stages and finalizes a resumable snapshot without placing the service key in the URL', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const request = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith('/begin_content_studio_sheet_snapshot')) return new Response(JSON.stringify({ state: 'staging', staged: 0 }));
      if (url.endsWith('/stage_content_studio_sheet_snapshot')) return new Response(JSON.stringify({ staged: 1 }));
      return new Response(JSON.stringify({ runId: runOne, snapshotHash: '0'.repeat(64), replayed: false, upserted: 1, retired: 0 }));
    };
    const store = new SupabaseSheetMirrorStore({ url: 'http://127.0.0.1:54321', serviceKey: 'server-only-test-key-000000', fetch: request as typeof fetch });
    const snapshot: SheetMirrorSnapshot = {
      schemaVersion: 1,
      sourceKey,
      runId: runOne,
      startedAt: '2026-09-25T00:00:00.000Z',
      counts: { schema: 0, library: 1, queue: 0, ready: 0, schedule: 0, queue_summary: 0, workflow_settings: 0 },
      snapshotHash: '0'.repeat(64),
      rows: [{ collection: 'library', stableId: 'SYN-L001', sourceRow: 2, sourceRevision: 'abc', rowHash: '1'.repeat(64), payload: { exact: '談薪水' } }],
    };
    await store.applySnapshot(snapshot);
    expect(calls.map((call) => call.url)).toEqual([
      'http://127.0.0.1:54321/rest/v1/rpc/begin_content_studio_sheet_snapshot',
      'http://127.0.0.1:54321/rest/v1/rpc/stage_content_studio_sheet_snapshot',
      'http://127.0.0.1:54321/rest/v1/rpc/finalize_content_studio_sheet_snapshot',
    ]);
    expect(calls.every((call) => !call.url.includes('server-only-test-key'))).toBe(true);
    expect(calls[0]?.init?.headers).toMatchObject({ Authorization: 'Bearer server-only-test-key-000000' });
    expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({ p_source_key: sourceKey, p_snapshot_hash: '0'.repeat(64) });
    expect(JSON.parse(String(calls[1]?.init?.body))).toMatchObject({ p_run_id: runOne, p_rows: [{ payload: { exact: '談薪水' } }] });
  });

  it('paginates active reads instead of silently accepting the REST row limit', async () => {
    const requests: string[] = [];
    const db = [0, 1, 2].map((n) => ({
      collection: 'library',
      stable_id: `SYN-L00${n}`,
      source_row: n + 2,
      source_revision: `rev-${n}`,
      row_hash: String(n).repeat(64),
      payload: { n },
    }));
    const request = async (input: string | URL | Request) => {
      const url = String(input);
      requests.push(url);
      const offset = Number(new URL(url).searchParams.get('offset'));
      return new Response(JSON.stringify(db.slice(offset, offset + 2)));
    };
    const store = new SupabaseSheetMirrorStore({ url: 'http://127.0.0.1:54321', serviceKey: 'server-only-test-key-000000', fetch: request as typeof fetch, pageRows: 2 });
    const rows = await store.readActive(sourceKey);
    expect(rows.map((item) => item.stableId)).toEqual(['SYN-L000', 'SYN-L001', 'SYN-L002']);
    expect(requests).toHaveLength(2);
    expect(new URL(requests[1]!).searchParams.get('offset')).toBe('2');
  });

  it('migration enables and forces RLS, denies browser roles, and grants only the server role', () => {
    const sql = readFileSync('supabase/migrations/20260925030000_sheet_read_model.sql', 'utf8').toLowerCase();
    expect(sql.match(/enable row level security/g)).toHaveLength(3);
    expect(sql.match(/force row level security/g)).toHaveLength(3);
    expect(sql).toContain('revoke all on table public.content_studio_sheet_rows from anon, authenticated');
    expect(sql).toContain('security invoker');
    expect(sql).not.toContain('security definer');
    expect(sql).toContain('grant execute on function public.finalize_content_studio_sheet_snapshot');
    expect(sql).not.toMatch(/grant\s+(?:select|insert|update|delete|all).*to\s+(?:anon|authenticated)/);
  });
});
