import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentReadCutoverRepository } from '@/application/content-read-cutover';
import type { ContentCollection, ContentPostRow, ContentScheduleRow, ContentWrite, ContentWriteResult } from '@/application/content-db';
import { FakeContentDb, syntheticContentDbSeed } from '@/integrations/supabase/fake-content-db';
import { FakeContentImportStore } from '@/integrations/supabase/fake-content-import';
import { FakeSheetTransport } from '@/integrations/google/fake-sheet';
import { FakeDriveGateway } from '@/integrations/google/fake-drive';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';
import { SupabaseContentDb } from '@/integrations/supabase/content-db';
import { runConfiguredSheetMirror } from '@/lib/sheet-mirror-operation';
import { getServices, resetServices } from '@/application/container';
import { resetEnvCache } from '@/lib/env';
import { buildTypedImport, importVersions } from '@/application/content-import';
import { buildSheetMirrorSnapshot } from '@/application/sheet-mirror';
import { LIBRARY_HEADERS, SCHEDULE_HEADERS, SHEET_TABS } from '@/domain/sheet-schema';
import { saveDraft } from '@/application/draft-save';
import { loadEditor } from '@/application/editor';
import { buildReconcileReport } from '@/application/reconcile';

const owner = { sub: 'synthetic-owner', role: 'owner' as const };
let pg: PGlite;
class SqlDb extends FakeContentDb {
  async rows<T>(sql: string, args: unknown[] = []) {
    return pg.transaction(async tx => { await tx.exec('set local role service_role'); return (await tx.query<T>(sql, args)).rows; });
  }
  override async getPost(kind: ContentCollection, id: string) { return (await this.rows<ContentPostRow>('select * from content_studio_posts where collection=$1 and library_id=$2', [kind, id]))[0] ?? null; }
  override async getSchedule(id: string) { return (await this.rows<ContentScheduleRow>('select * from content_studio_schedule where content_id=$1', [id]))[0] ?? null; }
  override async listPosts(kind: ContentCollection | 'ready') { return this.rows<ContentPostRow>(kind === 'ready' ? 'select * from content_studio_ready_queue' : 'select * from content_studio_posts where collection=$1', kind === 'ready' ? [] : [kind]); }
  override async listSchedule() { return this.rows<ContentScheduleRow>('select * from content_studio_schedule'); }
  override async writeThrough(w: ContentWrite) {
    // Exercise the production HTTP method against SQL by NAMED arguments,
    // including the real function catalog's parameter contract.
    const transport: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init!.body)) as Record<string, unknown>;
      const names = (await pg.query<{ proargnames: string[] }>("select proargnames from pg_proc where oid='content_studio_write_through(text,text,text,text,text,bigint,jsonb)'::regprocedure")).rows[0]!.proargnames;
      expect(Object.keys(body).sort()).toEqual([...names].sort());
      const result = await this.rows<{ r: ContentWriteResult }>(`select content_studio_write_through(${names.map((n, i) => `${n} => $${i + 1}`).join(',')}) r`, names.map(n => body[n]));
      return Response.json(result[0]!.r);
    };
    return new SupabaseContentDb({ url: 'https://synthetic.supabase.co', serviceKey: 'synthetic-service-key-only', fetch: transport }).writeThrough(w);
  }
}
beforeAll(async () => {
  pg = await PGlite.create();
  await pg.exec('create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon,authenticated,service_role;');
  for (const file of readdirSync('supabase/migrations').filter(f => /^\d+_content_.*\.sql$/.test(f)).sort()) await pg.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'));
});
afterAll(async () => { await pg?.close(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); resetEnvCache(); resetServices(); });

describe.each(['fake', 'pglite'] as const)('MIG-11 db-read / %s', mode => {
  let sheet: SheetsContentRepository;
  let transport: FakeSheetTransport;
  let db: FakeContentDb;
  let repo: ContentReadCutoverRepository;
  beforeEach(async () => {
    vi.stubEnv('CS_CONTENT_STORE', 'db-read'); vi.stubEnv('CS_DATA_MODE', 'fake'); resetEnvCache();
    transport = new FakeSheetTransport(); sheet = new SheetsContentRepository(transport);
    db = mode === 'fake' ? new FakeContentDb() : new SqlDb();
    if (mode === 'pglite') {
      await pg.exec('truncate content_studio_posts,content_studio_schedule,content_studio_workflow_settings,content_studio_import_runs,content_studio_operations,content_studio_row_history,content_studio_audit_events restart identity cascade');
      const seed = syntheticContentDbSeed();
      for (const [table, rows] of [['posts', seed.posts], ['schedule', seed.schedule], ['workflow_settings', seed.settings]] as const) for (const row of rows) {
        const columns = Object.keys(row).map(k => `"${k}"`).join(',');
        await pg.query(`insert into content_studio_${table} (${columns}) select ${columns} from jsonb_populate_record(null::content_studio_${table},$1)`, [row]);
      }
    }
    repo = new ContentReadCutoverRepository(sheet, db);
  });
  const ids = { library: 'SYN-L001', queue: 'IDEA-BL-0001', schedule: '2026-10-02-MAIN-X' };
  const read = (kind: keyof typeof ids) => kind === 'schedule' ? repo.getSchedule(ids[kind]) : kind === 'library' ? repo.getLibrary(ids[kind]) : repo.getQueue(ids[kind]);
  const write = (kind: keyof typeof ids, revision: string, text: string, op = 'synthetic_cutover_save') => {
    const m = { operationId: op, actor: owner, expectedRevision: revision };
    return kind === 'schedule' ? repo.updateSchedule({ ...m, target: { contentId: ids[kind] }, patch: { content: text } })
      : (kind === 'library' ? repo.updateLibrary.bind(repo) : repo.updateQueue.bind(repo))({ ...m, target: { libraryId: ids[kind] }, patch: { draftContent: text } });
  };
  it.each(['library', 'queue', 'schedule'] as const)('%s uses the imported Sheet token, writes Sheet first and immediately reads back exact copy', async kind => {
    const before = await read(kind);
    const authority = kind === 'schedule' ? await sheet.getSchedule(ids[kind]) : kind === 'library' ? await sheet.getLibrary(ids[kind]) : await sheet.getQueue(ids[kind]);
    expect(before.revision).toBe(authority.revision);
    const copy = vi.spyOn(db, 'writeThrough');
    const result = await write(kind, before.revision, 'Synthetic exact text 漢字 🙂\r\n  ');
    expect(result).toMatchObject({ ok: true, steps: [{ provider: 'sheet', status: 'done' }, { provider: 'db', step: 'write_through', status: 'done' }] });
    expect(copy).toHaveBeenCalledOnce();
    if (!result.ok) throw new Error('save failed');
    expect((await read(kind)).revision).toBe(result.value.revision);
    const copied = kind === 'schedule' ? await db.getSchedule(ids[kind]) : await db.getPost(kind, ids[kind]);
    expect(copied!.sheet_revision).toBe(result.value.revision);
    expect((copied as unknown as Record<string, unknown>)[kind === 'schedule' ? 'content' : 'draft_content']).toBe('Synthetic exact text 漢字 🙂\r\n  ');
    const historyCount = mode === 'fake' ? db.history.length : (await pg.query('select * from content_studio_row_history')).rows.length;
    expect(historyCount).toBe(1);
    expect(await write(kind, before.revision, 'Different', 'synthetic_stale_save')).toMatchObject({ ok: false, code: 'STALE_READ' });
    expect(await write(kind, before.revision, 'Different')).toMatchObject({ ok: false, code: 'CONFLICT' });
  });
  it.each(['library', 'queue', 'schedule'] as const)('%s refuses a Sheet edit since import without consulting DB for authority', async kind => {
    const before = await read(kind);
    const tab = kind === 'schedule' ? SHEET_TABS.schedule : SHEET_TABS[kind];
    const headers = kind === 'schedule' ? SCHEDULE_HEADERS : LIBRARY_HEADERS;
    const field = kind === 'schedule' ? 'content' : 'draftContent';
    transport.externalEdit(tab.name, before.row, transport.rawTab(tab.name)[tab.headerRow - 1]!.findIndex(c => c.value === headers[field as keyof typeof headers]), 'External synthetic text');
    const copy = vi.spyOn(db, 'writeThrough');
    expect(await write(kind, before.revision, 'Mine')).toMatchObject({ ok: false, code: 'STALE_READ' });
    expect(copy).not.toHaveBeenCalled();
  });
  it('DB read failure cannot veto a successful Sheet mutation', async () => {
    const before = await read('library');
    vi.spyOn(db, 'getPost').mockRejectedValue(new Error('synthetic outage'));
    expect(await write('library', before.revision, 'Saved despite outage')).toMatchObject({ ok: true, steps: [{ provider: 'sheet', status: 'done' }, { step: 'refresh_pending', status: 'pending' }] });
    expect((await repo.getLibrary(ids.library)).value.draftContent).toBe('Saved despite outage');
    expect((await sheet.getLibrary(ids.library)).value.draftContent).toBe('Saved despite outage');
  });
  it('a newer copy cannot be overwritten by an older replay', async () => {
    const before = await read('library');
    await write('library', before.revision, 'First');
    const middle = await read('library');
    await write('library', middle.revision, 'Second', 'synthetic_second');
    const copy = vi.spyOn(db, 'writeThrough');
    expect(await write('library', before.revision, 'First')).toMatchObject({ ok: true, replayed: true });
    expect(copy).not.toHaveBeenCalled();
    expect((await read('library')).value).toMatchObject({ draftContent: 'Second' });
  });
  it('draft preflight refuses the stale Sheet before changing Drive', async () => {
    const drive = new FakeDriveGateway();
    const model = await loadEditor(repo, drive, ids.library);
    expect(model.markdown.state).toBe('ok');
    const record = await read('library');
    transport.externalEdit(SHEET_TABS.library.name, record.row, transport.rawTab(SHEET_TABS.library.name)[0]!.findIndex(c => c.value === LIBRARY_HEADERS.currentHook), 'External hook');
    const writeDrive = vi.spyOn(drive, 'writeText');
    const result = await saveDraft(repo, drive, { operationId: 'synthetic_saga_guard', actor: owner, libraryId: ids.library, expectedSheetRevision: record.revision,
      expectedSectionHash: model.markdown.state === 'ok' ? model.markdown.sectionHash : '', proposed: 'Mine' });
    expect(result).toMatchObject({ ok: false, code: 'STALE_READ', conflict: { provider: 'sheet' } });
    expect(writeDrive).not.toHaveBeenCalled();
  });
  it('Queue append copies the new Sheet identity and fingerprint, then safely replays', async () => {
    const input = { operationId: 'synthetic_cutover_idea', actor: owner, libraryId: 'SYN-NEW-IDEA', sourcePlatform: 'X' as const, currentHook: 'Synthetic hook', draftContent: 'Synthetic idea' };
    const result = await repo.createQueueIdea(input);
    expect(result).toMatchObject({ ok: true, steps: [{ provider: 'sheet', status: 'done' }, { step: 'write_through', status: 'done' }] });
    if (!result.ok) throw new Error('append failed');
    expect((await repo.getQueue(input.libraryId)).revision).toBe(result.value.revision);
    expect((await db.getPost('queue', input.libraryId))!.sheet_revision).toBe(result.value.revision);
    expect(await repo.createQueueIdea(input)).toMatchObject({ ok: true, replayed: true });
    expect((await sheet.listQueue()).filter(r => r.value.libraryId === input.libraryId)).toHaveLength(1);
  });
  it('an overlapping import/copy refuses only the derived copy, preserving the Sheet save', async () => {
    const before = await read('library');
    const original = db.writeThrough.bind(db);
    vi.spyOn(db, 'writeThrough').mockImplementationOnce(async write => {
      if (mode === 'fake') db.externalEdit('library', ids.library, { current_hook: 'Concurrent imported hook' });
      else await pg.query('update content_studio_posts set row_version=row_version+1 where collection=$1 and library_id=$2', ['library', ids.library]);
      return original(write);
    });
    expect(await write('library', before.revision, 'Sheet still saved')).toMatchObject({ ok: true, steps: [{ provider: 'sheet', status: 'done' }, { step: 'refresh_pending', status: 'pending' }] });
    expect((await sheet.getLibrary(ids.library)).value.draftContent).toBe('Sheet still saved');
    expect((await repo.getLibrary(ids.library)).value.draftContent).toBe('Sheet still saved');
  });
  it('unsupported Sheet numeric text succeeds authoritatively and leaves an explicit pending copy', async () => {
    const before = await repo.getLibrary(ids.library);
    expect(await repo.updateLibrary({ operationId: 'synthetic_numeric_copy', actor: owner, target: { libraryId: ids.library }, expectedRevision: before.revision, patch: { hookScore: '8/10' } }))
      .toMatchObject({ ok: true, steps: [{ provider: 'sheet', status: 'done' }, { step: 'refresh_pending', status: 'pending', errorCode: 'VALIDATION_FAILED' }] });
    expect((await sheet.getLibrary(ids.library)).cells.hookScore).toBe('8/10');
  });
  it('a valid Sheet patch over the combined DB byte cap is saved with refresh pending', async () => {
    const before = await repo.getLibrary(ids.library), text = '漢'.repeat(45_000);
    const result = await repo.updateLibrary({ operationId: 'synthetic_large_copy', actor: owner, target: { libraryId: ids.library }, expectedRevision: before.revision,
      patch: { draftContent: text, imageBrief: text } });
    expect(result).toMatchObject({ ok: true, steps: [{ provider: 'sheet', status: 'done' }, { step: 'refresh_pending', status: 'pending', errorCode: 'VALIDATION_FAILED' }] });
    expect((await sheet.getLibrary(ids.library)).cells.draftContent).toBe(text);
    expect((await repo.getLibrary(ids.library)).cells.imageBrief).toBe(text);
  });
  it('keeps content-identical copies at the same row version', async () => {
    const before = await read('library');
    const row = await db.getPost('library', ids.library);
    const result = await write('library', before.revision, (await repo.getLibrary(ids.library)).value.draftContent);
    expect(result.ok).toBe(true);
    expect(String((await db.getPost('library', ids.library))!.row_version)).toBe(String(row!.row_version));
  });
  it('repairs a failed copy through the actual import boundary and clears reconciliation', async () => {
    const before = await repo.getLibrary(ids.library);
    vi.spyOn(db, 'writeThrough').mockRejectedValueOnce(new Error('synthetic copy failure'));
    expect(await write('library', before.revision, 'Synthetic import repair')).toMatchObject({ ok: true, steps: [{ provider: 'sheet', status: 'done' }, { step: 'refresh_pending', status: 'pending' }] });
    expect(await repo.refreshPending()).toContainEqual(expect.objectContaining({ id: ids.library }));
    const envelope = buildTypedImport(await buildSheetMirrorSnapshot(sheet, { sourceKey: 'synthetic_workbook' }), await importVersions(db), 'a'.repeat(64));
    if (mode === 'fake') await new FakeContentImportStore(undefined, db).applyImport(envelope);
    else {
      const result = await (db as SqlDb).rows<{ r: { ok: boolean } }>('select content_studio_import_run($1,$2,$3,$4,$5,$6,$7) r',
        [envelope.operationId, envelope.snapshotHash, envelope.actorHash, envelope.counts, envelope.hashes, envelope.exceptions, envelope.rows]);
      expect(result[0]!.r.ok).toBe(true);
    }
    expect(await repo.refreshPending()).toEqual([]);
    expect((await repo.getLibrary(ids.library)).revision).toBe((await sheet.getLibrary(ids.library)).revision);
  });
  it('preserves Sheet owner and validation refusals without any copy', async () => {
    const before = await repo.getLibrary(ids.library), copy = vi.spyOn(db, 'writeThrough');
    const m = { operationId: 'synthetic_validation', actor: owner, target: { libraryId: ids.library }, expectedRevision: before.revision, patch: { draftContent: 'Synthetic' } };
    expect(await repo.updateLibrary({ ...m, actor: { ...owner, role: 'viewer' } })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(await repo.updateLibrary({ ...m, patch: { slug: 'not writable' } })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(copy).not.toHaveBeenCalled(); expect(transport.writes).toEqual([]);
  });
  it('rollback retains all authoritative data including a save whose DB copy failed', async () => {
    const before = await repo.getLibrary(ids.library);
    vi.spyOn(db, 'writeThrough').mockRejectedValueOnce(new Error('synthetic copy failure'));
    expect((await write('library', before.revision, 'Synthetic rollback retained copy')).ok).toBe(true);
    const inventory = await Promise.all([sheet.listLibrary(), sheet.listQueue(), sheet.listSchedule()]);
    vi.stubEnv('CS_CONTENT_STORE', 'sheet');
    const rollback = new SheetsContentRepository(transport);
    const readDB = vi.spyOn(db, 'getPost').mockRejectedValue(new Error('DB MUST BE IGNORED'));
    expect(await Promise.all([rollback.listLibrary(), rollback.listQueue(), rollback.listSchedule()])).toEqual(inventory);
    expect((await rollback.getLibrary(ids.library)).value.draftContent).toBe('Synthetic rollback retained copy');
    expect(readDB).not.toHaveBeenCalled();
  });
});

it('successful mutation plus refresh_pending is repaired by the next configured import, also after restart', async () => {
  vi.stubEnv('CS_DATA_MODE', 'fake'); vi.stubEnv('CS_CONTENT_STORE', 'db-read'); resetEnvCache(); resetServices();
  const services = getServices(), repo = services.repo;
  const before = await repo.getLibrary('SYN-L001');
  services.fakes!.db.failNext({ op: 'write', code: 'PROVIDER_UNAVAILABLE' });
  const result = await repo.updateLibrary({ operationId: 'synthetic_failed_copy', actor: owner, target: { libraryId: 'SYN-L001' }, expectedRevision: before.revision, patch: { draftContent: 'Saved synthetic text' } });
  expect(result).toMatchObject({ ok: true, steps: [{ provider: 'sheet', status: 'done' }, { step: 'refresh_pending', status: 'pending' }] });
  expect((await repo.listLibrary()).find(r => r.value.libraryId === 'SYN-L001')!.value.draftContent).toBe('Saved synthetic text');
  const restarted = new ContentReadCutoverRepository(services.importRepo!, services.fakes!.db);
  expect(await restarted.refreshPending()).toContainEqual(expect.objectContaining({ id: 'SYN-L001' }));
  const report = await buildReconcileReport(repo, services.drive);
  expect(report.items).toContainEqual(expect.objectContaining({ kind: 'refresh_pending', stableIds: ['SYN-L001'] }));
  await runConfiguredSheetMirror({ kind: 'scheduled' });
  expect(await repo.refreshPending!()).toEqual([]);
  expect(await restarted.refreshPending()).toEqual([]);
  expect((await repo.getLibrary('SYN-L001')).value.draftContent).toBe('Saved synthetic text');
  expect((await repo.getLibrary('SYN-L001')).revision).toBe((await services.importRepo!.getLibrary('SYN-L001')).revision);
});

it('MIG-11 rollback ignores an unavailable or contradictory DB for EVERY read and write path', async () => {
  vi.stubEnv('CS_DATA_MODE', 'fake'); vi.stubEnv('CS_CONTENT_STORE', 'sheet'); resetEnvCache(); resetServices();
  const services = getServices(), db = services.fakes!.db;
  const methods = ['schemaVersion', 'listPosts', 'getPost', 'listSchedule', 'getSchedule', 'queueSummary', 'workflowSettings', 'applyPatch', 'insertQueueIdea', 'writeThrough'] as const;
  const spies = methods.map(m => vi.spyOn(db, m).mockRejectedValue(new Error('DB MUST BE IGNORED')));
  for (const method of ['schema', 'listLibrary', 'listQueue', 'listReadyQueue', 'listSchedule', 'queueSummary', 'workflowSettings'] as const) await services.repo[method]();
  const row = await services.repo.getLibrary('SYN-L001');
  expect((await services.repo.updateLibrary({ operationId: 'synthetic_rollback', actor: owner, target: { libraryId: 'SYN-L001' }, expectedRevision: row.revision, patch: { draftContent: 'Rollback synthetic write' } })).ok).toBe(true);
  await services.repo.getQueue('IDEA-BL-0001'); await services.repo.getSchedule('2026-10-02-MAIN-X');
  for (const spy of spies) expect(spy).not.toHaveBeenCalled();
});

it('configured import always captures the fresh Sheet instead of its DB read model', async () => {
  vi.stubEnv('CS_DATA_MODE', 'fake'); vi.stubEnv('CS_CONTENT_STORE', 'db-read'); resetEnvCache(); resetServices();
  const services = getServices(), sheet = services.fakes!.sheet;
  const before = await services.repo.getLibrary('SYN-L001');
  const column = sheet.rawTab(SHEET_TABS.library.name)[0]!.findIndex(c => c.value === LIBRARY_HEADERS.currentHook);
  sheet.externalEdit(SHEET_TABS.library.name, before.row, column, 'Fresh synthetic Sheet hook');
  const dbReadModel = vi.spyOn(services.repo, 'listLibrary').mockRejectedValue(new Error('import must ignore the DB read model'));
  await expect(runConfiguredSheetMirror({ kind: 'scheduled' })).resolves.toMatchObject({ status: 'completed' });
  expect(dbReadModel).not.toHaveBeenCalled();
  expect((await services.repo.getLibrary('SYN-L001')).cells.currentHook).toBe('Fresh synthetic Sheet hook');
});
