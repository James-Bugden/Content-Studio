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
import { createDraft } from '@/application/typefully';
import { FakeTypefullyGateway } from '@/integrations/typefully/fake-gateway';
import { sha256 } from '@/integrations/supabase/content-repository';
import { contentSheetCacheOptions, DB_READ_CACHE_TTL_MS } from '@/application/content-cache';

const owner = { sub: 'synthetic-owner', role: 'owner' as const };
let pg: PGlite;
class SqlDb extends FakeContentDb {
  async rows<T>(sql: string, args: unknown[] = []) {
    return pg.transaction(async tx => { await tx.exec('set local role service_role');
      // Match the production JSON transport (PGlite returns native Date values).
      return JSON.parse(JSON.stringify((await tx.query<T>(sql, args)).rows)) as T[];
    });
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
  const importSheet = async () => {
    const e = buildTypedImport(await buildSheetMirrorSnapshot(sheet, { sourceKey: 'synthetic_workbook' }), await importVersions(db), 'a'.repeat(64));
    if (mode === 'fake') await new FakeContentImportStore(undefined, db).applyImport(e);
    else expect((await (db as SqlDb).rows<{ r: { ok: boolean } }>('select content_studio_import_run($1,$2,$3,$4,$5,$6,$7) r',
      [e.operationId, e.snapshotHash, e.actorHash, e.counts, e.hashes, e.exceptions, e.rows]))[0]!.r.ok).toBe(true);
    return e;
  };
  it('B1: a failed R1 copy followed by a hand-edited R2 import retires the overlay on get/list, without reconcile', async () => {
    const before = await repo.getLibrary(ids.library);
    vi.spyOn(db, 'writeThrough').mockRejectedValueOnce(new Error('synthetic outage'));
    expect((await write('library', before.revision, 'App save R1')).ok).toBe(true);
    transport.externalEdit(SHEET_TABS.library.name, before.row, transport.rawTab(SHEET_TABS.library.name)[0]!.findIndex(c => c.value === LIBRARY_HEADERS.draftContent), 'External R2');
    await importSheet();
    expect((await db.getPost('library', ids.library))!.draft_content).toBe('External R2');
    expect((await repo.getLibrary(ids.library)).value.draftContent).toBe('External R2');
    expect((await repo.listLibrary()).find(r => r.value.libraryId === ids.library)!.value.draftContent).toBe('External R2');
    expect(repo.pendingRefresh('library', ids.library)).toBe(false);
    expect((await write('library', (await repo.getLibrary(ids.library)).revision, 'App save R3', 'synthetic_after_repair')).ok).toBe(true);
  });
  it('B1: metadata-only repair can retire a superseded overlay without a row_version bump', async () => {
    const before = await repo.getLibrary(ids.library), original = await db.getPost('library', ids.library);
    const score = String(original!.hook_score ?? 8);
    // Establish a known typed baseline before testing representation-only changes.
    transport.externalEdit(SHEET_TABS.library.name, before.row, transport.rawTab(SHEET_TABS.library.name)[0]!.findIndex(c => c.value === LIBRARY_HEADERS.hookScore), score);
    await importSheet();
    const version = String((await db.getPost('library', ids.library))!.row_version);
    vi.spyOn(db, 'writeThrough').mockRejectedValueOnce(new Error('synthetic outage'));
    await repo.updateLibrary({ operationId: 'synthetic_metadata_overlay', actor: owner, target: { libraryId: ids.library }, expectedRevision: (await repo.getLibrary(ids.library)).revision, patch: { hookScore: `0${score}` } });
    transport.externalEdit(SHEET_TABS.library.name, before.row, transport.rawTab(SHEET_TABS.library.name)[0]!.findIndex(c => c.value === LIBRARY_HEADERS.hookScore), `00${score}`);
    await importSheet();
    expect(String((await db.getPost('library', ids.library))!.row_version)).toBe(version);
    // List is the first read here; it must clear the overlay independently of get.
    expect((await repo.listLibrary()).find(r => r.value.libraryId === ids.library)!.revision).toBe((await sheet.getLibrary(ids.library)).revision);
    expect(repo.pendingRefresh('library', ids.library)).toBe(false);
  });
  const read = (kind: keyof typeof ids) => kind === 'schedule' ? repo.getSchedule(ids[kind]) : kind === 'library' ? repo.getLibrary(ids[kind]) : repo.getQueue(ids[kind]);
  const write = (kind: keyof typeof ids, revision: string, text: string, op = 'synthetic_cutover_save') => {
    const m = { operationId: op, actor: owner, expectedRevision: revision };
    return kind === 'schedule' ? repo.updateSchedule({ ...m, target: { contentId: ids[kind] }, patch: { content: text } })
      : (kind === 'library' ? repo.updateLibrary.bind(repo) : repo.updateQueue.bind(repo))({ ...m, target: { libraryId: ids[kind] }, patch: { draftContent: text } });
  };
  const editSheet = (field: keyof typeof LIBRARY_HEADERS, text: string, row: number) => transport.externalEdit(SHEET_TABS.library.name, row,
    transport.rawTab(SHEET_TABS.library.name)[0]!.findIndex(c => c.value === LIBRARY_HEADERS[field]), text);
  const advanceDb = async () => {
    if (mode === 'fake') db.externalEdit('library', ids.library, { current_hook: 'Concurrent snapshot' });
    else await pg.query('update content_studio_posts set current_hook=$1,row_version=row_version+1 where collection=$2 and library_id=$3', ['Concurrent snapshot', 'library', ids.library]);
  };
  it('M04: observes the copy version before the authority write, not after a raced import', async () => {
    const before = await read('library'), version = String((await db.getPost('library', ids.library))!.row_version);
    const original = sheet.updateLibrary.bind(sheet);
    vi.spyOn(sheet, 'updateLibrary').mockImplementationOnce(async m => { await advanceDb(); return original(m); });
    const copy = vi.spyOn(db, 'writeThrough');
    const result = await write('library', before.revision, 'New Sheet save');
    expect(copy.mock.calls[0]![0].expectedVersion).toBe(version);
    expect(result.steps).toContainEqual(expect.objectContaining({ step: 'refresh_pending' }));
    // A DB version bump alone MUST NOT retire this newer authoritative overlay.
    expect((await repo.getLibrary(ids.library)).value.draftContent).toBe('New Sheet save');
    expect(repo.pendingRefresh('library', ids.library)).toBe(true);
  });
  it('M06: a failed in-flight copy re-reads a newer Sheet edit for the overlay', async () => {
    const before = await read('library');
    vi.spyOn(db, 'writeThrough').mockImplementationOnce(async () => {
      editSheet('draftContent', 'Newer Sheet edit while copying', before.row);
      throw new Error('synthetic outage');
    });
    expect((await write('library', before.revision, 'First response')).ok).toBe(true);
    expect((await repo.getLibrary(ids.library)).value.draftContent).toBe('Newer Sheet edit while copying');
  });
  it('M10: Ready Queue adds and removes pending Library rows using the saved eligibility', async () => {
    const before = await repo.getLibrary(ids.library);
    vi.spyOn(db, 'writeThrough').mockRejectedValue(new Error('synthetic outage'));
    const m = { actor: owner, target: { libraryId: ids.library } };
    const saved = await repo.updateLibrary({ ...m, operationId: 'synthetic_ready_overlay', expectedRevision: before.revision,
      patch: { reviewStatus: 'Approved', queueForSchedule: 'TRUE', draftContent: 'Eligible pending text' } });
    expect(saved.ok).toBe(true);
    expect((await repo.listReadyQueue()).find(r => r.value.libraryId === ids.library)?.value.draftContent).toBe('Eligible pending text');
    await repo.updateLibrary({ ...m, operationId: 'synthetic_unready_overlay', expectedRevision: (await repo.getLibrary(ids.library)).revision, patch: { queueForSchedule: 'FALSE' } });
    expect((await repo.listReadyQueue()).find(r => r.value.libraryId === ids.library)).toBeUndefined();
  });
  it('M15/M30: successful copies immediately remove the overlay and use a separate hashed operation ID', async () => {
    const before = await read('library'), copy = vi.spyOn(db, 'writeThrough');
    expect((await write('library', before.revision, 'Copied successfully', 'synthetic_distinct_operation')).ok).toBe(true);
    expect(repo.pendingRefresh('library', ids.library)).toBe(false);
    expect(copy.mock.calls[0]![0]).toMatchObject({ operationId: `copy_${sha256('synthetic_distinct_operation')}`, actorHash: sha256(owner.sub) });
  });
  it('M30: copy operation identity stays separate even if an overlay is retained', async () => {
    const before = await read('library'), copy = vi.spyOn(db, 'writeThrough');
    await write('library', before.revision, 'Separate ledger identity', 'synthetic_copy_namespace');
    expect(copy.mock.calls[0]![0].operationId).toBe(`copy_${sha256('synthetic_copy_namespace')}`);
  });
  it('M16: a reconciliation scan captured before a newer failed save cannot delete its overlay', async () => {
    const before = await read('library'), snapshot = await sheet.listLibrary();
    let release!: (rows: typeof snapshot) => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    vi.spyOn(sheet, 'listLibrary').mockImplementationOnce(() => { entered(); return new Promise(resolve => { release = resolve; }); });
    const scan = repo.refreshPending(); await started;
    vi.spyOn(db, 'writeThrough').mockRejectedValueOnce(new Error('synthetic outage'));
    await write('library', before.revision, 'Saved during scan');
    release(snapshot); await scan;
    expect(repo.pendingRefresh('library', ids.library)).toBe(true);
    expect((await repo.getLibrary(ids.library)).value.draftContent).toBe('Saved during scan');
  });
  it('M17/M27: draft saga preserves pending steps and editor reload exposes the pending saved model', async () => {
    const drive = new FakeDriveGateway(), editor = await loadEditor(repo, drive, ids.library);
    if (editor.markdown.state !== 'ok') throw new Error('fixture Markdown unavailable');
    vi.spyOn(db, 'writeThrough').mockRejectedValueOnce(new Error('synthetic outage'));
    const result = await saveDraft(repo, drive, { operationId: 'synthetic_saga_pending', actor: owner, libraryId: ids.library,
      expectedSheetRevision: (await read('library')).revision, expectedSectionHash: editor.markdown.sectionHash, proposed: 'Synthetic saga pending copy' });
    expect(result.ok).toBe(true);
    expect(result.steps).toContainEqual(expect.objectContaining({ step: 'refresh_pending', provider: 'db', status: 'pending' }));
    expect(await loadEditor(repo, drive, ids.library)).toMatchObject({ refreshPending: true, sheet: { draft: 'Synthetic saga pending copy' } });
  });
  it('M19: Typefully saga preserves refresh_pending after linking a successfully created draft', async () => {
    const id = '2026-10-02-MAIN-LI', clock = () => new Date('2026-09-30T00:00:00Z'), tf = new FakeTypefullyGateway(undefined, clock);
    vi.spyOn(db, 'writeThrough').mockRejectedValueOnce(new Error('synthetic outage'));
    const result = await createDraft(repo, tf, owner, { operationId: 'synthetic_typefully_pending', contentId: id, expectedRevision: (await repo.getSchedule(id)).revision }, { now: clock });
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
    expect(result.steps).toContainEqual(expect.objectContaining({ step: 'refresh_pending', provider: 'db', status: 'pending' }));
    expect((await sheet.getSchedule(id)).value.typefullyDraftId).toMatch(/^SYNTH-TF-/);
  });
  it('M27: editor model exposes a direct-save pending overlay independently of saga steps', async () => {
    const before = await read('library');
    vi.spyOn(db, 'writeThrough').mockRejectedValueOnce(new Error('synthetic outage'));
    await write('library', before.revision, 'Pending model copy');
    expect((await loadEditor(repo, new FakeDriveGateway(), ids.library)).refreshPending).toBe(true);
  });
  it('N2: hand-edit lag is reported without a save identity or a read overlay', async () => {
    const before = await read('library'); editSheet('draftContent', 'External import lag', before.row);
    expect(await repo.refreshPending()).toContainEqual({ kind: 'library', id: ids.library, source: 'import' });
    expect(repo.pendingRefresh('library', ids.library)).toBe(false);
    expect((await read('library')).revision).toBe(before.revision);
    const report = await buildReconcileReport(repo, new FakeDriveGateway());
    const item = report.items.find(i => i.kind === 'refresh_pending' && i.stableIds.includes(ids.library));
    expect(item).toBeDefined(); expect(JSON.stringify(item)).not.toContain('Saved'); expect(JSON.stringify(item)).not.toContain('import_repair');
    expect(JSON.stringify(item)).toContain('behind the Sheet');
    editSheet('draftContent', 'Another external edit', before.row); await importSheet();
    expect((await repo.getLibrary(ids.library)).value.draftContent).toBe('Another external edit');
  });
  it.each(['numeric', 'size'] as const)('N1: a refused %s row is ledgered while another row imports, and remains a truthful blocking pending item', async refusal => {
    const before = await read('library'), huge = '漢'.repeat(45_000);
    const patch = refusal === 'numeric' ? { hookScore: '8/10' } : { draftContent: huge, imageBrief: huge };
    const saved = await repo.updateLibrary({ operationId: `synthetic_refused_${refusal}`, actor: owner, target: { libraryId: ids.library }, expectedRevision: before.revision, patch });
    expect(saved.ok).toBe(true);
    const other = (await sheet.listLibrary()).find(r => r.value.libraryId !== ids.library)!;
    editSheet('draftContent', 'Other row continues importing', other.row);
    const e = await importSheet();
    const expectedClass = refusal === 'numeric' ? 'refused_numeric' : 'refused_size';
    expect(e.exceptions.filter(e => e.class === expectedClass)).toHaveLength(1);
    expect(e.exceptions).toContainEqual(expect.objectContaining({ class: expectedClass, field: refusal === 'numeric' ? 'hook_score' : '@row', collection: 'library' }));
    expect(e.rows.some(r => r.target_kind === 'library' && r.target_id === ids.library)).toBe(false);
    expect(e.counts.library).toBe((await sheet.listLibrary()).length - 1);
    expect((await db.getPost('library', other.value.libraryId))!.draft_content).toBe('Other row continues importing');
    if (mode === 'pglite') expect((await (db as SqlDb).rows<{ exceptions: unknown }>('select exceptions from content_studio_import_runs where operation_id=$1', [e.operationId]))[0]!.exceptions).toEqual(e.exceptions);
    const report = await buildReconcileReport(repo, new FakeDriveGateway());
    const item = report.items.find(i => i.kind === 'refresh_pending' && i.stableIds.includes(ids.library));
    expect(item).toMatchObject({ severity: 'blocking' }); expect(JSON.stringify(item)).toContain(expectedClass);
    expect(JSON.stringify(item)).not.toContain('next import'); expect(JSON.stringify(e.exceptions)).not.toContain('8/10');
    // A restart reconstructs the refusal, but never installs a stale save overlay.
    const restarted = new ContentReadCutoverRepository(sheet, db);
    expect(await restarted.refreshPending()).toContainEqual(expect.objectContaining({ id: ids.library, source: 'import', refusal: expectedClass }));
    expect(restarted.pendingRefresh('library', ids.library)).toBe(false);
    // Correcting the source makes the same row importable again.
    editSheet(refusal === 'numeric' ? 'hookScore' : 'imageBrief', refusal === 'numeric' ? '8' : '', before.row);
    await importSheet(); expect(await repo.refreshPending()).toEqual([]);
  });
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

it('B1: configured cached composition retires R1 immediately after an R2 import, within the display TTL', async () => {
  vi.stubEnv('CS_DATA_MODE', 'fake'); vi.stubEnv('CS_CONTENT_STORE', 'db-read'); resetEnvCache(); resetServices();
  const s = getServices(), before = await s.repo.getLibrary('SYN-L001');
  s.fakes!.db.failNext({ op: 'write', code: 'PROVIDER_UNAVAILABLE' });
  await s.repo.updateLibrary({ operationId: 'synthetic_cached_r1', actor: owner, target: { libraryId: 'SYN-L001' }, expectedRevision: before.revision, patch: { draftContent: 'Cached R1' } });
  s.fakes!.sheet.externalEdit(SHEET_TABS.library.name, before.row, s.fakes!.sheet.rawTab(SHEET_TABS.library.name)[0]!.findIndex(c => c.value === LIBRARY_HEADERS.draftContent), 'Imported R2');
  await runConfiguredSheetMirror({ kind: 'scheduled' });
  expect((await s.repo.getLibrary('SYN-L001')).value.draftContent).toBe('Imported R2');
  expect(s.repo.pendingRefresh!('library', 'SYN-L001')).toBe(false);
});

it.each(['fake', 'live'] as const)('N4: %s db-read composition uses the single 3-second cache config', mode => {
  expect(DB_READ_CACHE_TTL_MS).toBe(3_000);
  expect(contentSheetCacheOptions('db-read', mode)).toEqual({ readCacheMs: 3_000, libraryReadCacheMs: 3_000, readinessReadCacheMs: 3_000 });
});

it('N4: the fake composition actually expires Library authority reads after 3 seconds', async () => {
  vi.useFakeTimers();
  try {
    vi.stubEnv('CS_DATA_MODE', 'fake'); vi.stubEnv('CS_CONTENT_STORE', 'db-read'); resetEnvCache(); resetServices();
    const services = getServices(), repo = services.repo as ContentReadCutoverRepository;
    const before = await repo.authorityLibrary('SYN-L001'), sheet = services.fakes!.sheet;
    sheet.externalEdit(SHEET_TABS.library.name, before.row, sheet.rawTab(SHEET_TABS.library.name)[0]!.findIndex(c => c.value === LIBRARY_HEADERS.draftContent), 'After short TTL');
    vi.advanceTimersByTime(2_999); expect((await repo.authorityLibrary('SYN-L001')).revision).toBe(before.revision);
    vi.advanceTimersByTime(2); expect((await repo.authorityLibrary('SYN-L001')).value.draftContent).toBe('After short TTL');
  } finally { vi.useRealTimers(); }
});
