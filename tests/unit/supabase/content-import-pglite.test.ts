import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../replies/support/db';
import { buildTypedImport, type ImportEnvelope } from '@/application/content-import';
import { buildSheetMirrorSnapshot, mirrorHash } from '@/application/sheet-mirror';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';
import { FakeSheetTransport } from '@/integrations/google/fake-sheet';

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
