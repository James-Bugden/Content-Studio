import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../replies/support/db';
import { buildTypedImport, type ImportEnvelope } from '@/application/content-import';
import { buildSheetMirrorSnapshot, mirrorHash } from '@/application/sheet-mirror';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';
import { FakeSheetTransport } from '@/integrations/google/fake-sheet';
import { FakeContentDb } from '@/integrations/supabase/fake-content-db';
import type { ContentPostRow, ContentScheduleRow, ContentSettingRow } from '@/application/content-db';
import { getServices, resetServices } from '@/application/container';
import { resetEnvCache } from '@/lib/env';
import { runConfiguredSheetMirror } from '@/lib/sheet-mirror-operation';

beforeEach(async () => {
  vi.stubEnv('CS_CONTENT_STORE', 'db-shadow');
  await db.raw.exec('truncate content_studio_posts, content_studio_schedule, content_studio_workflow_settings, content_studio_operations, content_studio_import_runs, content_studio_audit_events, content_studio_row_history restart identity cascade');
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); resetServices(); resetEnvCache(); });
let db: TestDatabase;
const actor = mirrorHash('synthetic-import');
const rpc = (e: ImportEnvelope) => db.asService(q => q.query<{ result: { ok: boolean } }>('select public.content_studio_import_run($1,$2,$3,$4,$5,$6,$7) as result',
  [e.operationId, e.snapshotHash, e.actorHash, e.counts, e.hashes, e.exceptions, e.rows]));
beforeAll(async () => {
  db = await createTestDatabase();
  for (const migration of ['20261024000100_content_authority.sql', '20261024000200_content_summary_reads.sql']) await db.raw.exec(readFileSync(`supabase/migrations/${migration}`, 'utf8'));
}, 120_000);
afterAll(async () => { await db?.close(); });

describe('MIG-09 actual DB-1 import RPC with DB-4 envelopes', () => {
  it('scheduled reruns capture fresh SQL versions, preserve no-op/metadata versions, and reject a raced version atomically', async () => {
    vi.stubEnv('CS_DATA_MODE', 'fake'); resetServices(); resetEnvCache();
    const services = getServices(), reader = new FakeContentDb({ posts: [], schedule: [], settings: [] });
    const query = async <T>(sql: string, params?: unknown[]) => (await db.asService(q => q.query<T>(sql, params))).rows;
    vi.spyOn(reader, 'schemaVersion').mockImplementation(async () => (await query<{ version: number }>('select version from content_studio_schema_version'))[0]!.version);
    vi.spyOn(reader, 'listPosts').mockImplementation(c => query<ContentPostRow>('select * from content_studio_posts where collection=$1', [c]));
    vi.spyOn(reader, 'listSchedule').mockImplementation(() => query<ContentScheduleRow>('select * from content_studio_schedule'));
    vi.spyOn(reader, 'workflowSettings').mockImplementation(() => query<ContentSettingRow>('select * from content_studio_workflow_settings'));
    const envelopes: ImportEnvelope[] = [];
    services.contentImport = { db: reader, applyImport: async e => { envelopes.push(e); expect((await rpc(e)).rows[0]!.result.ok).toBe(true); } };
    // Read the Sheet directly here: shadow sampling is independently tested.
    services.repo = new SheetsContentRepository(new FakeSheetTransport());
    const first = await runConfiguredSheetMirror({ kind: 'scheduled' });
    const originals = await services.repo.listLibrary(), id = originals[0]!.value.libraryId;
    const state = async () => (await query<{ row_version: number; sheet_revision: string; draft_content: string }>('select row_version,sheet_revision,draft_content from content_studio_posts where collection=$1 and library_id=$2', ['library', id]))[0]!;
    const history = async () => Number((await query<{ n: number }>('select count(*)::integer as n from content_studio_row_history'))[0]!.n);
    const start = await state(), initialHistory = await history();
    const second = await runConfiguredSheetMirror({ kind: 'scheduled' });
    expect(second.runId).not.toBe(first.runId);
    expect(envelopes[1]!.operationId).not.toBe(envelopes[0]!.operationId);
    expect(envelopes[0]!.rows.find(r => r.target_id === id)?.expected_version).toBe(null);
    expect(envelopes[1]!.rows.find(r => r.target_id === id)?.expected_version).toBe(1);
    expect(await state()).toEqual(start); expect(await history()).toBe(initialHistory);

    const changed = structuredClone(originals); changed[0]!.revision = 'abcdefabcdefabcd';
    vi.spyOn(services.repo, 'listLibrary').mockResolvedValue(changed);
    await runConfiguredSheetMirror({ kind: 'scheduled' });
    expect(await state()).toEqual({ ...start, sheet_revision: 'abcdefabcdefabcd' });
    expect(await history()).toBe(initialHistory + 1);
    const patch = async (op: string, version: number, text: string) => query<{ result: { ok: boolean; code: string } }>('select content_studio_apply_patch($1,$2,$3,$4,$5,$6,$7) as result', [op, mirrorHash([op, text]), actor, 'library', id, version, { draft_content: text }]);
    expect((await patch('synthetic-external-1', 1, 'Synthetic external edit'))[0]!.result.ok).toBe(true);
    await runConfiguredSheetMirror({ kind: 'scheduled' });
    expect(envelopes.at(-1)!.rows.find(r => r.target_id === id)?.expected_version).toBe(2);
    expect((await state()).row_version).toBe(3);
    // Capture version=3, then change SQL while the importer reads the Sheet.
    vi.spyOn(services.repo, 'listLibrary').mockImplementationOnce(async () => {
      expect((await patch('synthetic-race-1', 3, 'Synthetic concurrent edit'))[0]!.result.ok).toBe(true);
      return changed;
    });
    const runsBefore = await query('select operation_id from content_studio_import_runs order by operation_id');
    await expect(runConfiguredSheetMirror({ kind: 'scheduled' })).rejects.toMatchObject({ code: '40001' });
    expect(envelopes.at(-1)!.rows.find(r => r.target_id === id)?.expected_version).toBe(3);
    expect((await state()).row_version).toBe(4);
    expect((await state()).draft_content).toBe('Synthetic concurrent edit');
    expect(await query('select operation_id from content_studio_import_runs order by operation_id')).toEqual(runsBefore);
    // The underlying compare-and-set result explicitly identifies STALE_READ.
    expect((await patch('synthetic-stale-probe', 3, 'Synthetic refused edit'))[0]!.result).toMatchObject({ ok: false, code: 'STALE_READ' });
  });
  it('imports every typed synthetic field exactly, replays, and rolls back an invalid late row with history/ledger', async () => {
    const sheet = new SheetsContentRepository(new FakeSheetTransport());
    const e = buildTypedImport(await buildSheetMirrorSnapshot(sheet, { sourceKey: 'synthetic_workbook' }), new Map(), actor);
    expect((await rpc(e)).rows[0]?.result.ok).toBe(true);
    const table = { library: 'posts', queue: 'posts', schedule: 'schedule', workflow_settings: 'workflow_settings' };
    for (const r of e.rows) {
      const key = r.target_kind === 'schedule' ? 'content_id' : r.target_kind === 'workflow_settings' ? 'setting' : 'library_id';
      const { rows } = await db.asService(q => q.query<Record<string, unknown>>(`select * from public.content_studio_${table[r.target_kind]} where ${key}=$1${key === 'library_id' ? ' and collection=$2' : ''}`, key === 'library_id' ? [r.target_id, r.target_kind] : [r.target_id]));
      const actual = rows[0]!;
      for (const [k, v] of Object.entries(r.row)) {
        if (k.endsWith('_at') && typeof v === 'string') expect(Date.parse(String(actual[k]))).toBe(Date.parse(v));
        else expect(actual[k], `${r.target_kind}.${k}`).toEqual(v);
      }
    }
    const counts = async () => (await db.asService(q => q.query('select (select count(*) from public.content_studio_row_history) as history,(select count(*) from public.content_studio_operations) as operations,(select count(*) from public.content_studio_import_runs) as runs'))).rows;
    const before = await counts();
    expect((await rpc(e)).rows[0]?.result.ok).toBe(true);
    expect(await counts()).toEqual(before);
    const broken = structuredClone(e); broken.operationId = 'synthetic-failed-import';
    broken.rows[0]!.row.draft_content = 'Synthetic rolled back';
    for (const r of broken.rows) r.expected_version = 1;
    broken.rows.at(-1)!.row.not_a_column = 'synthetic';
    broken.snapshotHash = mirrorHash({ counts: broken.counts, hashes: broken.hashes, exceptions: broken.exceptions, rows: broken.rows });
    await expect(rpc(broken)).rejects.toThrow();
    expect(await counts()).toEqual(before);
    expect((await db.asService(q => q.query("select count(*) as n from public.content_studio_posts where draft_content='Synthetic rolled back'"))).rows[0]).toEqual({ n: 0 });
  });
});
