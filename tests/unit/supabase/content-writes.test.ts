import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentCollection, ContentPostRow, ContentScheduleRow, ContentTarget, ContentWrite, ContentWriteResult } from '@/application/content-db';
import type { ContentRepository } from '@/application/ports';
import { FakeSheetTransport } from '@/integrations/google/fake-sheet';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';
import { FakeContentDb, syntheticContentDbSeed } from '@/integrations/supabase/fake-content-db';
import { SupabaseContentRepository, contentPatch, sha256 } from '@/integrations/supabase/content-repository';
import { SupabaseContentDb } from '@/integrations/supabase/content-db';
import { CONTENT_STUDIO_SCHEMA_VERSION, assertContentSchemaVersion } from '@/integrations/supabase/content-schema';
import { exportContentAudit, type ContentAuditEvent } from '@/integrations/supabase/content-audit';
import { LIBRARY_HEADERS, SCHEDULE_HEADERS, SHEET_TABS } from '@/domain/sheet-schema';
import type { LibraryPatch, SchedulePatch } from '@/domain/mapping';
import type { MutationEnvelope } from '@/domain/mutation';
import { AppError } from '@/domain/errors';

const owner = { sub: 'synthetic-owner', role: 'owner' as const };
let pg: PGlite;
const migrations = ['20261024000100_content_authority.sql', '20261024000200_content_summary_reads.sql', '20261025000100_content_writes.sql'];

/** Real SQL behind the same port, without a network or hosted credentials. */
class SqlContentDb extends FakeContentDb {
  async service<T>(sql: string, params: unknown[] = []) {
    return pg.transaction(async tx => { await tx.exec('set local role service_role'); return (await tx.query<T>(sql, params)).rows; });
  }
  override async getPost(kind: ContentCollection, id: string) { return (await this.service<ContentPostRow>('select * from content_studio_posts where collection=$1 and library_id=$2', [kind, id]))[0] ?? null; }
  override async getSchedule(id: string) { return (await this.service<ContentScheduleRow>('select * from content_studio_schedule where content_id=$1', [id]))[0] ?? null; }
  override async applyPatch(w: ContentWrite) { return (await this.service<{ r: ContentWriteResult }>('select content_studio_apply_patch($1,$2,$3,$4,$5,$6,$7) r', [w.operationId,w.patchHash,w.actorHash,w.kind,w.id,w.expectedVersion,w.data]))[0]!.r; }
  override async insertQueueIdea(w: ContentWrite) { return (await this.service<{ r: ContentWriteResult }>('select content_studio_insert_queue_idea($1,$2,$3,$4,$5) r', [w.operationId,w.patchHash,w.actorHash,w.id,w.data]))[0]!.r; }
  override async mutationRow(kind: ContentTarget, id: string, version: string) {
    const old = (await this.service<{ before_image: ContentPostRow | ContentScheduleRow }>('select before_image from content_studio_row_history where target_kind=$1 and target_id=$2 and row_version_before=$3 order by history_id limit 1', [kind,id,version]))[0];
    if (old) return old.before_image;
    const row = kind === 'schedule' ? await this.getSchedule(id) : await this.getPost(kind,id);
    if (!row || String(row.row_version) !== version) throw new Error('missing committed revision');
    return row;
  }
}

beforeAll(async () => {
  pg = await PGlite.create();
  await pg.exec('create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon, authenticated, service_role; alter default privileges in schema public grant execute on functions to anon, authenticated;');
  for (const file of migrations) await pg.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'));
  const version = (await pg.query<{version:number}>('select version from content_studio_schema_version')).rows[0]!.version;
  expect(version).toBe(CONTENT_STUDIO_SCHEMA_VERSION);
  assertContentSchemaVersion(version);
});
afterAll(async () => { await pg?.close(); });

describe.each(['sheet', 'fake-db', 'sql-db'] as const)('MIG-07 %s mutation contract', mode => {
  let repo: ContentRepository;
  let fake: FakeContentDb;
  let sheet: FakeSheetTransport;
  let sql: SqlContentDb;
  beforeEach(async () => {
    fake = new FakeContentDb(); sheet = new FakeSheetTransport(); sql = new SqlContentDb();
    repo = mode === 'sheet' ? new SheetsContentRepository(sheet) : new SupabaseContentRepository(mode === 'sql-db' ? sql : fake);
    if (mode === 'sql-db') {
      await pg.exec('truncate content_studio_posts,content_studio_schedule,content_studio_operations,content_studio_row_history,content_studio_audit_events restart identity cascade');
      const seed = syntheticContentDbSeed();
      await pg.transaction(async tx => {
        for (const [table, rows] of [['posts',seed.posts],['schedule',seed.schedule]] as const) for (const row of rows) {
          const columns = Object.keys(row).map(k => `"${k}"`).join(',');
          await tx.query(`insert into content_studio_${table} (${columns}) select ${columns} from jsonb_populate_record(null::content_studio_${table}, $1)`, [row]);
        }
      });
    }
  });
  const get = (kind: ContentTarget, id: string) => kind === 'schedule' ? repo.getSchedule(id) : kind === 'library' ? repo.getLibrary(id) : repo.getQueue(id);
  const update = (kind: ContentTarget, m: MutationEnvelope<{ libraryId: string; contentId: string }, LibraryPatch & SchedulePatch>) => kind === 'schedule' ? repo.updateSchedule(m) : kind === 'library' ? repo.updateLibrary(m) : repo.updateQueue(m);
  const edit = async (kind: ContentTarget, id: string, patch: Record<string,string>) => {
    if (mode === 'fake-db') fake.externalEdit(kind,id,contentPatch(patch));
    else if (mode === 'sql-db') {
      const r = await get(kind,id);
      const result = await update(kind,{ operationId: 'synthetic_external_edit',actor: owner,target: {libraryId:id,contentId:id},expectedRevision:r.revision,patch });
      expect(result.ok).toBe(true);
    } else {
      const r = await get(kind,id); const tab = kind === 'schedule' ? SHEET_TABS.schedule : SHEET_TABS[kind];
      const headers = kind === 'schedule' ? SCHEDULE_HEADERS : LIBRARY_HEADERS;
      const raw = sheet.rawTab(tab.name); const header = raw[tab.headerRow-1]!.map(c => c.value);
      for (const [field,value] of Object.entries(patch)) sheet.externalEdit(tab.name,r.row,header.indexOf(headers[field as keyof typeof headers]),value);
    }
  };

  it.each(['library','queue','schedule'] as const)('%s: exact write, replay, patch conflict, stale with current token, lost response, no-op', async kind => {
    const id = kind === 'schedule' ? '2026-10-02-MAIN-X' : kind === 'library' ? 'SYN-L001' : 'IDEA-BL-0001';
    const field = kind === 'schedule' ? 'content' : 'draftContent';
    const before = await get(kind,id);
    const m = { operationId: 'synthetic_contract_write',actor: owner,target:{libraryId:id,contentId:id},expectedRevision:before.revision,patch:{[field]:'Synthetic exact copy 漢字 🙂\r\n  '}};
    const first = await update(kind,m);
    expect(first).toMatchObject({ok:true,replayed:false,steps:[{provider:mode==='sheet'?'sheet':'db',status:'done'}]});
    if (!first.ok) return;
    expect(first.value.cells[field as keyof typeof first.value.cells]).toBe(m.patch[field]);
    expect(first.value.revision).not.toBe(before.revision);
    expect(await update(kind,m)).toEqual({...first,replayed:true});
    expect(await update(kind,{...m,patch:{[field]:'Different'}})).toMatchObject({ok:false,code:'CONFLICT',details:{reason:'operation_reused_with_different_patch'}});
    const stale = {...m,operationId:'synthetic_contract_stale',patch:{[field]:'Another'}};
    expect(await update(kind,stale)).toMatchObject({ok:false,code:'STALE_READ',details:{currentRevision:first.value.revision,expectedRevision:before.revision}});
    expect(await update(kind,{...m,operationId:'synthetic_lost_response'})).toMatchObject({ok:true,replayed:true,steps:[{status:'skipped_already_applied'}]});
    expect(await update(kind,{...m,operationId:'synthetic_noop',expectedRevision:first.value.revision})).toMatchObject({ok:true,replayed:false,steps:[{status:'skipped_already_applied'}]});
    const retry = await update(kind,{...stale,expectedRevision:first.value.revision});
    expect(retry.ok).toBe(true);
    expect(await update(kind,m)).toEqual({...first,replayed:true});
  });

  it('checks owner, operation ID, not-found, allowlist, empty patch, value types and cap', async () => {
    const before = await repo.getLibrary('SYN-L001');
    const m = {operationId:'synthetic_validation',actor:owner,target:{libraryId:'SYN-L001'},expectedRevision:before.revision,patch:{draftContent:'Synthetic'}};
    expect(await repo.updateLibrary({...m,actor:{...owner,role:'viewer'}})).toMatchObject({ok:false,code:'FORBIDDEN'});
    expect(await repo.updateLibrary({...m,operationId:'bad'})).toMatchObject({ok:false,code:'VALIDATION_FAILED',details:{reason:'operation_id'}});
    for (const [patch,reason] of [[{},'empty_patch'],[{slug:'bad'},'field_not_writable'],[{draftContent:'x'.repeat(50_001)},'value_invalid'],[{draftContent:42},'value_invalid']] as const)
      expect(await repo.updateLibrary({...m,patch:patch as LibraryPatch})).toMatchObject({ok:false,code:'VALIDATION_FAILED',details:{reason}});
    expect(await repo.updateLibrary({...m,target:{libraryId:'SYN-MISSING'}})).toMatchObject({ok:false,code:'NOT_FOUND'});
    // NOT_FOUND did not consume the ID.
    expect((await repo.updateLibrary(m)).ok).toBe(true);
  });

  it('external edits cannot be silently overwritten', async () => {
    const before = await repo.getLibrary('SYN-L001');
    await edit('library','SYN-L001',{draftContent:'External synthetic edit'});
    expect(await repo.updateLibrary({operationId:'synthetic_external_guard',actor:owner,target:{libraryId:'SYN-L001'},expectedRevision:before.revision,patch:{draftContent:'Mine'}})).toMatchObject({ok:false,code:'STALE_READ',details:{currentRevision:(await repo.getLibrary('SYN-L001')).revision}});
  });

  it('Queue creation, exact field set, replay, collision and validation', async () => {
    const m = {operationId:'synthetic_idea_create',actor:owner,libraryId:'SYN-IDEA',sourcePlatform:'X' as const,currentHook:'Synthetic hook',draftContent:'Synthetic idea'};
    const first = await repo.createQueueIdea(m);
    expect(first).toMatchObject({ok:true,replayed:false,value:{cells:{state:'Idea',contentSource:'Social Replies',reviewStatus:'Not Reviewed',nextAction:'Promote to Editing',queueForSchedule:'FALSE'}}});
    expect(await repo.createQueueIdea(m)).toEqual({...first,replayed:true});
    expect(await repo.createQueueIdea({...m,draftContent:'Different'})).toMatchObject({ok:false,code:'CONFLICT',details:{reason:'operation_reused_with_different_idea'}});
    expect(await repo.createQueueIdea({...m,operationId:'synthetic_idea_lost'})).toMatchObject({ok:true,replayed:true,steps:[{status:'skipped_already_applied'}]});
    expect(await repo.createQueueIdea({...m,operationId:'synthetic_collision',draftContent:'Different'})).toMatchObject({ok:false,code:'CONFLICT',details:{reason:'library_id_already_used'}});
    expect(await repo.createQueueIdea({...m,currentHook:''})).toMatchObject({ok:false,code:'VALIDATION_FAILED',details:{reason:'content'}});
    expect(await repo.createQueueIdea({...m,libraryId:'bad/id'})).toMatchObject({ok:false,code:'VALIDATION_FAILED',details:{reason:'identifier'}});
  });

  if (mode !== 'sheet') {
  it('refuses a Schedule identity rename before sending SQL', async () => {
    const before = await repo.getSchedule('2026-10-02-MAIN-X');
    const db = mode === 'sql-db' ? sql : fake;
    const spy = vi.spyOn(db,'applyPatch');
    try {
      expect(await repo.updateSchedule({operationId:'synthetic_rename_refused',actor:owner,target:{contentId:before.value.contentId},expectedRevision:before.revision,patch:{contentId:'2026-10-03-MAIN-X'}})).toMatchObject({ok:false,code:'VALIDATION_FAILED',details:{reason:'field_not_writable',field:'contentId'}});
      expect(spy).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });
  it('DB instances share replay and preserve the original result after another edit', async () => {
    const db = mode === 'sql-db' ? sql : fake;
    const second = new SupabaseContentRepository(db);
    const before = await repo.getLibrary('SYN-L001');
    const m = {operationId:'synthetic_cross_instance',actor:owner,target:{libraryId:'SYN-L001'},expectedRevision:before.revision,patch:{draftContent:'First'}};
    const [a,b] = await Promise.all([repo.updateLibrary(m),second.updateLibrary(m)]);
    expect(a.ok && b.ok).toBe(true);
    expect(b).toEqual({...a,replayed:true});
    await edit('library','SYN-L001',{draftContent:'Newer'});
    expect(await second.updateLibrary(m)).toEqual({...a,replayed:true});
    expect((await second.getLibrary('SYN-L001')).cells.draftContent).toBe('Newer');
    expect(await second.updateLibrary({...m,actor:{...owner,sub:'synthetic-other-owner'}})).toMatchObject({ok:false,code:'CONFLICT'});
  });

  it('replaces and clears imported asset hyperlinks along with the cell', async () => {
    const before = await repo.getLibrary('SYN-L001');
    const m = {operationId:'synthetic_asset_replace',actor:owner,target:{libraryId:'SYN-L001'},expectedRevision:before.revision,patch:{imageFile:'https://example.invalid/synthetic-new-asset'}};
    const first = await repo.updateLibrary(m);
    expect(first).toMatchObject({ok:true,value:{links:{imageFile:m.patch.imageFile}}});
    if (!first.ok) return;
    const clear = await repo.updateLibrary({...m,operationId:'synthetic_asset_clear',expectedRevision:first.value.revision,patch:{imageFile:''}});
    expect(clear.ok).toBe(true);
    if (clear.ok) expect(clear.value.links.imageFile).toBeUndefined();
  });

  it('MIG-08 changed writes have before-images, one event, content-free ledger and safe export', async () => {
    const before = await repo.getLibrary('SYN-L001');
    const m = {operationId:'synthetic_private_operation_identifier',actor:owner,target:{libraryId:'SYN-L001'},expectedRevision:before.revision,patch:{draftContent:'PRIVATE_SYNTHETIC_COPY https://example.invalid/secret-url'}};
    expect((await repo.updateLibrary(m)).ok).toBe(true);
    expect((await repo.updateLibrary(m)).ok).toBe(true);
    const history = mode === 'sql-db' ? await sql.service<{before_image:ContentPostRow;changed_fields:string[]}>('select * from content_studio_row_history') : fake.history;
    const audit = mode === 'sql-db' ? await sql.service<ContentAuditEvent>('select * from content_studio_audit_events') : fake.audit;
    expect(history).toHaveLength(1); expect(audit).toHaveLength(1);
    expect((history[0]!.before_image! as ContentPostRow).draft_content).toBe(before.cells.draftContent);
    expect(history[0]!.changed_fields).toEqual(['draft_content']);
    expect(audit[0]).toMatchObject({before_hash:expect.stringMatching(/^[a-f0-9]{64}$/),after_hash:expect.stringMatching(/^[a-f0-9]{64}$/),changed_fields:['draft_content']});
    if (mode === 'sql-db') expect(JSON.stringify(await sql.service('select result from content_studio_operations'))).not.toContain('PRIVATE_SYNTHETIC_COPY');
    const exported = exportContentAudit(audit);
    const text = JSON.stringify(exported);
    for (const forbidden of ['PRIVATE_SYNTHETIC_COPY','https://',m.operationId,m.target.libraryId,owner.sub]) expect(text).not.toContain(forbidden);
    for (const row of exported) for (const key of ['operationHash','actorHash','targetHash','beforeHash','afterHash'] as const) expect(row[key]?.length).toBeLessThanOrEqual(12);
  });
  it('two different first deliveries cannot overwrite the same version', async () => {
    const db = mode === 'sql-db' ? sql : fake;
    const other = new SupabaseContentRepository(db);
    const before = await repo.getLibrary('SYN-L001');
    const m = {operationId:'synthetic_race_first',actor:owner,target:{libraryId:'SYN-L001'},expectedRevision:before.revision,patch:{draftContent:'First'}};
    const results = await Promise.all([repo.updateLibrary(m), other.updateLibrary({...m,operationId:'synthetic_race_other',patch:{draftContent:'Other'}})]);
    expect(results.filter(r=>r.ok)).toHaveLength(1);
    expect(results.filter(r=>!r.ok)).toEqual([expect.objectContaining({code:'STALE_READ',details:expect.objectContaining({currentRevision:(await repo.getLibrary('SYN-L001')).revision})})]);
  });
  it('concurrent identical patches with different IDs report the lost response truthfully', async () => {
    const db = mode === 'sql-db' ? sql : fake;
    const before = await repo.getLibrary('SYN-L001');
    const m = {operationId:'synthetic_identical_first',actor:owner,target:{libraryId:'SYN-L001'},expectedRevision:before.revision,patch:{draftContent:'Identical'}};
    const results = await Promise.all([repo.updateLibrary(m),new SupabaseContentRepository(db).updateLibrary({...m,operationId:'synthetic_identical_other'})]);
    expect(results).toEqual([expect.objectContaining({ok:true,replayed:false,steps:[expect.objectContaining({status:'done'})]}),expect.objectContaining({ok:true,replayed:true,steps:[expect.objectContaining({status:'skipped_already_applied'})]})]);
  });
  it('a failed confirmation replays the committed result without a second write', async () => {
    const db = mode === 'sql-db' ? sql : fake;
    const before = await repo.getLibrary('SYN-L001');
    const m = {operationId:'synthetic_confirmation',actor:owner,target:{libraryId:'SYN-L001'},expectedRevision:before.revision,patch:{draftContent:'Committed'}};
    const spy = vi.spyOn(db,'mutationRow').mockRejectedValueOnce(new AppError('PROVIDER_UNAVAILABLE'));
    try {
      expect(await repo.updateLibrary(m)).toMatchObject({ok:false,code:'PARTIAL_FAILURE',steps:[{provider:'db',status:'done'},{provider:'db',status:'failed'}]});
      expect(await new SupabaseContentRepository(db).updateLibrary(m)).toMatchObject({ok:true,replayed:true,value:{cells:{draftContent:'Committed'}}});
      const history = mode === 'sql-db' ? await sql.service('select * from content_studio_row_history') : fake.history;
      expect(history).toHaveLength(1);
    } finally { spy.mockRestore(); }
  });
  }
});

describe('DB-1 carried review items and atomicity', () => {
  beforeEach(async () => {
    await pg.exec("insert into content_studio_posts(collection,library_id) values ('library','SYN-L001') on conflict do nothing");
  });
  it('binds the entry-point mode independently of a trusted caller hash', async () => {
    const db = new SqlContentDb();
    const args: unknown[] = ['synthetic_mode_identity', sha256('same'), sha256('actor'), 'library', 'SYN-L001', null, { draft_content: 'Mode proof' }];
    const current = await db.getPost('library','SYN-L001'); args[5] = current!.row_version;
    const first = await db.service<{r:ContentWriteResult}>('select content_studio_write_through($1,$2,$3,$4,$5,$6,$7) r', args);
    expect(first[0]!.r.ok).toBe(true);
    const wrongMode = await db.service<{r:ContentWriteResult}>('select content_studio_apply_patch($1,$2,$3,$4,$5,$6,$7) r', args);
    expect(wrongMode[0]!.r).toMatchObject({ok:false,code:'CONFLICT',steps:[{reason:'operation_reused_with_different_patch'}]});
    expect(await db.service('select mode from content_studio_operations where operation_id=$1',[args[0]])).toEqual([{mode:'copy'}]);
    expect(await db.service<{r:ContentWriteResult}>('select content_studio_write_through($1,$2,$3,$4,$5,$6,$7) r', args)).toEqual([{r:{...first[0]!.r,replayed:true}}]);
  });
  it.each(['anon','authenticated'])('denies %s the private helper and leaves no public helper', async role => {
    expect((await pg.query("select oid from pg_proc where pronamespace='public'::regnamespace and proname='content_studio_mutate'")).rows).toHaveLength(0);
    await expect(pg.transaction(async tx => {
      await tx.exec(`set local role ${role}`);
      await tx.query('select content_studio_private.content_studio_mutate($1,$2,$3,$4,$5,$6,$7,$8)', ['import','synthetic_denial',sha256('patch'),sha256('actor'),'library','SYN-L001',1,{draft_content:'Forbidden'}]);
    })).rejects.toMatchObject({code:'42501'});
  });
  it('rolls CAS, history and ledger back on audit failure', async () => {
    const db = new SqlContentDb(); const before = await db.getPost('library','SYN-L001');
    const counts = () => pg.query('select (select count(*) from content_studio_row_history) h,(select count(*) from content_studio_operations) o');
    const originalCounts = (await counts()).rows;
    await pg.exec("create function public.synthetic_fail_audit() returns trigger language plpgsql as $$ begin raise exception 'synthetic failure'; end $$; create trigger synthetic_fail before insert on content_studio_audit_events for each row execute function public.synthetic_fail_audit();");
    try {
      await expect(db.applyPatch({operationId:'synthetic_atomic_failure',patchHash:sha256('rollback'),actorHash:sha256('actor'),kind:'library',id:'SYN-L001',expectedVersion:String(before!.row_version),data:{draft_content:'Must roll back'}})).rejects.toMatchObject({code:'P0001'});
    } finally { await pg.exec('drop trigger synthetic_fail on content_studio_audit_events; drop function public.synthetic_fail_audit()'); }
    expect(await db.getPost('library','SYN-L001')).toEqual(before);
    expect((await counts()).rows).toEqual(originalCounts);
  });
});

describe('unwired PostgREST write transport', () => {
  const write: ContentWrite = {operationId:'synthetic_transport',patchHash:sha256('patch'),actorHash:sha256('actor'),kind:'library',id:'SYN-L001',expectedVersion:'1',data:{draft_content:'Synthetic'}};
  it('does not erase a hyperlink when the patch leaves its display cell unchanged', () => {
    expect(contentPatch({imageFile:'Synthetic label'}, {imageFile:'Synthetic label'})).toEqual({image_file:'Synthetic label'});
    expect(contentPatch({imageFile:''}, {imageFile:'Synthetic label'})).toEqual({image_file:'',image_file_url:''});
  });
  it('refuses a pre-DB-3 schema before any write', async () => {
    const db = new FakeContentDb(syntheticContentDbSeed(),1);
    expect(await new SupabaseContentRepository(db).updateLibrary({operationId:'synthetic_schema_drift',actor:owner,target:{libraryId:'SYN-L001'},expectedRevision:'0000000000000000',patch:{draftContent:'Synthetic'}})).toMatchObject({ok:false,code:'SCHEMA_DRIFT'});
    expect(db.history).toHaveLength(0); expect(db.audit).toHaveLength(0);
  });
  it.each(['40001','23505'])('retries %s in a fresh request with identical identity, bounded to three attempts', async code => {
    let calls = 0;
    const request = vi.fn<typeof fetch>(async () => ++calls < 3 ? Response.json({code,message:'PRIVATE'}, {status:409}) : Response.json({ok:true,code:null,steps:[{state:'applied'}],revision:2}));
    const db = new SupabaseContentDb({url:'https://synthetic-db.supabase.co',serviceKey:'SYNTHETIC_SERVICE_KEY_ONLY',fetch:request});
    expect((await db.applyPatch(write)).ok).toBe(true);
    expect(request).toHaveBeenCalledTimes(3);
    expect(new Set(request.mock.calls.map(c=>c[1]?.body)).size).toBe(1);
    expect(request.mock.calls[0]![1]).toMatchObject({method:'POST',headers:{'Content-Type':'application/json'}});
    request.mockImplementation(async()=>Response.json({code,message:'PRIVATE'}, {status:409})); request.mockClear();
    await expect(db.applyPatch(write)).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE'});
    expect(request).toHaveBeenCalledTimes(3);
  });
  it('does not retry unknown network outcomes or expose provider text', async () => {
    const request = vi.fn<typeof fetch>(async()=>{throw new Error('PRIVATE URL AND COPY');});
    const db = new SupabaseContentDb({url:'https://synthetic-db.supabase.co',serviceKey:'SYNTHETIC_SERVICE_KEY_ONLY',fetch:request});
    await expect(db.applyPatch(write)).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE',details:{provider:'db',reason:'network'}});
    expect(request).toHaveBeenCalledTimes(1);
  });
  it.each([
    {ok:false,code:'STALE_READ',steps:[{state:'stale'}],revision:2,replayed:true},
    {ok:true,code:null,steps:[{state:'stale'}],revision:2},
    {ok:false,code:'STALE_READ',steps:[{state:'stale'}],revision:null},
    {ok:true,code:null,steps:[{state:'applied'}],revision:Number.MAX_SAFE_INTEGER+1},
  ])('fails closed on an inconsistent mutation response: %j', async body => {
    const db = new SupabaseContentDb({url:'https://synthetic-db.supabase.co',serviceKey:'SYNTHETIC_SERVICE_KEY_ONLY',fetch:async()=>Response.json(body)});
    await expect(db.applyPatch(write)).rejects.toMatchObject({code:'SCHEMA_DRIFT'});
  });
});

describe('DB-3 SQL guards and live client against the SQL catalog', () => {
  const sql = new SqlContentDb();
  const write = (operationId: string, data: Record<string, unknown>, kind: ContentTarget = 'library', id = 'SYN-GUARD'): ContentWrite =>
    ({operationId, patchHash:sha256([operationId, JSON.stringify(data)].join(':')), actorHash:sha256('synthetic-actor'), kind, id, expectedVersion:'1', data});
  beforeEach(async () => {
    await pg.exec("truncate content_studio_posts,content_studio_schedule,content_studio_operations,content_studio_row_history,content_studio_audit_events restart identity cascade; insert into content_studio_posts(collection,library_id) values ('library','SYN-GUARD'),('queue','SYN-QUEUE'); insert into content_studio_schedule(content_id) values ('SYN-SCHEDULE')");
  });
  it.each([
    ['library', {slug:'changed'}], ['schedule', {posted:true}],
    // Schedule has no second Library writable allowlist to mask a removed
    // source-metadata protection check.
    ['schedule', {source_sheet_row:50}], ['schedule', {sheet_revision:'1234567890abcdef'}], ['schedule', {passthrough:{synthetic:'value'}}],
  ] as const)('SQL refuses %s patch %j without changing rows, ledger or history', async (kind, data) => {
    const read = () => kind === 'schedule' ? sql.getSchedule('SYN-SCHEDULE') : sql.getPost('library','SYN-GUARD');
    const before = await read();
    await expect(sql.applyPatch(write('synthetic_guard', data, kind, kind === 'schedule' ? 'SYN-SCHEDULE' : 'SYN-GUARD'))).rejects.toMatchObject({code:'22023'});
    expect(await read()).toEqual(before);
    expect(await sql.service('select * from content_studio_row_history')).toEqual([]);
    expect(await sql.service('select * from content_studio_operations')).toEqual([]);
  });
  it('failed not-found, stale and queue-collision attempts are audited without consuming IDs', async () => {
    const attempts = [write('synthetic_missing',{draft_content:'Synthetic'},'library','SYN-MISSING'),
      {...write('synthetic_stale',{draft_content:'Synthetic'}),expectedVersion:'2'},
      write('synthetic_collision',{draft_content:'Synthetic'},'queue','SYN-QUEUE')];
    expect((await sql.applyPatch(attempts[0]!)).code).toBe('NOT_FOUND');
    expect((await sql.applyPatch(attempts[1]!)).code).toBe('STALE_READ');
    expect((await sql.insertQueueIdea(attempts[2]!)).code).toBe('CONFLICT');
    expect(await sql.service('select operation_id,outcome from content_studio_audit_events order by event_id')).toEqual([
      {operation_id:'synthetic_missing',outcome:'not_found'}, {operation_id:'synthetic_stale',outcome:'stale'}, {operation_id:'synthetic_collision',outcome:'conflict'},
    ]);
    expect(await sql.service('select * from content_studio_operations')).toEqual([]);
    expect(await sql.service('select * from content_studio_row_history')).toEqual([]);
  });
  it('enforces the byte cap independently in the adapter and SQL, including nested JSON', async () => {
    const patch = {draftContent:'漢'.repeat(45_000),currentHook:'字'.repeat(45_000)};
    expect(() => contentPatch(patch)).toThrowError(expect.objectContaining({code:'VALIDATION_FAILED',details:{reason:'value_size'}}));
    await expect(sql.applyPatch(write('synthetic_byte_cap',{draft_content:patch.draftContent,current_hook:patch.currentHook}))).rejects.toMatchObject({code:'22023'});
    const args = ['synthetic_nested_cap',sha256('nested'),sha256('actor'),'library','SYN-GUARD',1,{passthrough:{synthetic:'x'.repeat(262_144)}}];
    await expect(sql.service('select content_studio_write_through($1,$2,$3,$4,$5,$6,$7)',args)).rejects.toMatchObject({code:'22023'});
    expect((await sql.getPost('library','SYN-GUARD'))!.row_version).toBe(1);
  });
  it('runs live RPC names/parameters and mutationRow ordering against real SQL', async () => {
    // Only the HTTP boundary is replaced. Parameter names come from pg_proc;
    // filters/order emitted by the production client execute against PGlite.
    const request: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      const name = url.pathname.split('/').at(-1)!;
      if (init?.method === 'POST') {
        expect(['content_studio_apply_patch','content_studio_insert_queue_idea']).toContain(name);
        const catalog = await pg.query<{proargnames:string[]}>('select proargnames from pg_proc where pronamespace=\'public\'::regnamespace and proname=$1',[name]);
        const names = catalog.rows[0]!.proargnames;
        const body = JSON.parse(String(init.body)) as Record<string,unknown>;
        expect(Object.keys(body).sort()).toEqual([...names].sort());
        const result = await sql.service<{r:ContentWriteResult}>(`select ${name}(${names.map((n,i)=>`${n} => $${i+1}`).join(',')}) r`,names.map(n=>body[n]));
        return Response.json(result[0]!.r);
      }
      expect(name).toBe('content_studio_row_history');
      const params = url.searchParams;
      const order = params.get('order')!;
      expect(order).toMatch(/^history_id\.(asc|desc)$/);
      const result = await sql.service(`select * from content_studio_row_history where target_kind=$1 and target_id=$2 and row_version_before=$3 order by ${order.replace('.', ' ')} limit $4 offset $5`,
        ['target_kind','target_id','row_version_before'].map(k=>params.get(k)!.replace(/^eq\./,'')).concat([params.get('limit')!,params.get('offset')!]));
      return Response.json(result,{headers:{'content-range':`0-${result.length-1}/${result.length}`}});
    };
    const live = new SupabaseContentDb({url:'https://synthetic-db.supabase.co',serviceKey:'SYNTHETIC_SERVICE_KEY_ONLY',fetch:request});
    const w = write('synthetic_live_patch',{draft_content:'Committed synthetic copy'});
    expect(await live.applyPatch(w)).toMatchObject({ok:true,revision:2});
    expect(await live.insertQueueIdea(write('synthetic_live_insert',{draft_content:'Synthetic idea'},'queue','SYN-NEW'))).toMatchObject({ok:true,revision:1});
    const committed = await sql.getPost('library','SYN-GUARD');
    for (const [index, revision] of ['aaaaaaaaaaaaaaaa','bbbbbbbbbbbbbbbb'].entries()) {
      const result = await sql.service<{r:ContentWriteResult}>('select content_studio_write_through($1,$2,$3,$4,$5,$6,$7) r',
        [`synthetic_metadata_${index}`,sha256(revision),w.actorHash,w.kind,w.id,2,{sheet_revision:revision,source_sheet_row:index+10}]);
      expect(result[0]!.r).toMatchObject({ok:true,revision:2});
      expect((await sql.getPost('library','SYN-GUARD'))!.row_version).toBe(2);
    }
    expect(await live.applyPatch({...write('synthetic_later_patch',{draft_content:'Newer synthetic copy'}),expectedVersion:'2'})).toMatchObject({ok:true,revision:3});
    const restored = await live.mutationRow('library','SYN-GUARD','2');
    // JSON history serializes timestamps; compare through the same boundary.
    expect(restored).toMatchObject(Object.fromEntries(Object.entries(committed!).filter(([key]) => !['created_at','updated_at'].includes(key))));
    expect(await live.applyPatch(w)).toMatchObject({ok:true,replayed:true,revision:2});
  });
  it('rejects non-ISO/offset-free timestamps and normalizes explicit instants', () => {
    for (const stamp of ['2026/10/01 09:00','2026-10-01T09:00:00']) expect(() => contentPatch({publishedAt:stamp})).toThrowError(expect.objectContaining({code:'VALIDATION_FAILED'}));
    expect(contentPatch({publishedAt:'2026-10-01T09:00:00+08:00'})).toEqual({published_at:'2026-10-01T01:00:00.000Z'});
    expect(contentPatch({publishedAt:'2026-10-01T01:00:00Z'})).toEqual({published_at:'2026-10-01T01:00:00.000Z'});
  });
  it('exports only named field names, even when an audit row contains private or prototype strings', () => {
    const [event] = exportContentAudit([{operation_id:'synthetic-op',actor_hash:'synthetic-actor',target_kind:'library',target_id:'SYN-GUARD',changed_fields:['draft_content','PRIVATE_SYNTHETIC_COPY','https://example.invalid/private','constructor','__proto__'],before_hash:null,after_hash:null,outcome:'applied'}]);
    expect(event!.changedFields).toEqual(['draft_content']);
  });
});
