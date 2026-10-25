import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../replies/support/db';
import { GET } from '@/app/api/ops/content-cutover/route';
import { GET as health } from '@/app/api/health/route';
import { resetEnvCache } from '@/lib/env';
import { ContentCutoverStore } from '@/integrations/supabase/content-cutover-store';
// @ts-expect-error dependency-free owner runner
import { cutover } from '../../../scripts/cutover.mjs';

let db: TestDatabase;
const build = 'a'.repeat(40), hash = 'b'.repeat(64), importId = 'synthetic-import';
const options = { url: 'https://synthetic.supabase.co', serviceKey: 'synthetic-status-service-key' };
const query = (sql: string, args: unknown[] = []) => db.asService(q => q.query(sql,args));
const req = () => new Request('https://synthetic.example/api/ops/content-cutover', { headers: { authorization: 'Bearer synthetic-status-cron-secret' } });
const read = async () => { const res = await GET(req()); expect(res.status).toBe(200); return (await res.json()).status; };
const record = (name: string, payload: unknown) => query('select content_studio_cutover_record($1,$2,$3,$4)',[name,build,importId,payload]);
const phase = () => ({ smoke:true,t4:true,writeThrough:true,freeze:true,dailyPlanBackup:true,restoreExact:true,importsStopped:true,flagRoundTrip:true,
  hostedSecurity:true,independentConcurrency:true,sheetRaceAccepted:true,privateEvidence:'SYNTHETIC_PRIVATE_REFERENCE',sheetRead429:0,lagStale:0,warmP95Ms:100,coldP95Ms:200 });
async function green() {
  await record('parity',{ coverage:'all-rows',samples:Object.fromEntries(['library','queue','ready','schedule','queue_summary','workflow_settings'].map(k=>[k,{idsEqual:true,fields:1,equal:1,blocking:0,lagMs:0}])) });
  await record('phase-c',phase()); await record('rehearsal',{exact:true,dbHash:hash,sheetHash:hash,differences:[]}); await record('backup',{manifestHash:hash});
}
async function audit() {
  await query('select content_studio_cutover_waive_backup($1,$2,$3,$4,$5)', ['11111111-1111-4111-8111-111111111111',build,importId,'2026-10-25',hash]);
}
beforeAll(async () => {
  db = await createTestDatabase();
  for (const file of readdirSync('supabase/migrations').filter(f=>/^\d+_content_.*\.sql$/.test(f)).sort()) await db.raw.exec(readFileSync(`supabase/migrations/${file}`,'utf8'));
},120_000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.raw.exec('truncate content_studio_backup_waivers,content_studio_cutover_jobs,content_studio_cutover_state,content_studio_cutover_evidence,content_studio_cutover_authority,content_studio_import_runs,content_studio_shadow_events cascade');
  await query('insert into content_studio_import_runs(operation_id,snapshot_hash,counts,hashes,exceptions) values($1,$2,$3,$4,$5)',[importId,hash,{}, {}, []]);
  for (const [k,v] of Object.entries({ CS_DATA_MODE:'live', CS_CONTENT_STORE:'sheet', CS_COMMIT_SHA:build, VERCEL_GIT_COMMIT_SHA:'', VERCEL_DEPLOYMENT_ID:'dpl_synthetic123',
    CRON_SECRET:'synthetic-status-cron-secret', CS_CONTENT_WRITE_ENABLED:'false', CS_BACKUP_GATE_WAIVED:'', CS_PARITY_WINDOW_WAIVED:'', CS_CONTENT_BACKUP_FOLDER_ID:'',
    SUPABASE_READ_MODEL_URL:options.url, SUPABASE_READ_MODEL_SERVICE_KEY:options.serviceKey })) vi.stubEnv(k,v);
  resetEnvCache();
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (url,init) => {
    expect(String(url)).toMatch(/^https:\/\/synthetic\.supabase\.co\/rest\/v1\/rpc\/content_studio_cutover_(status|backup_receipt)$/);
    const name = String(url).split('/').at(-1)!; const params = JSON.parse(String(init?.body)); const keys = Object.keys(params);
    const result = await query(`select ${name}(${keys.map((k,i)=>`${k}=>$${i+1}`).join(',')}) as result`,Object.values(params));
    return Response.json(result.rows[0]!.result);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); resetEnvCache(); });

it('reads real SQL through authenticated GET and does not change any table', async () => {
  await green(); const tables = ['content_studio_cutover_jobs','content_studio_cutover_state','content_studio_cutover_evidence','content_studio_cutover_authority','content_studio_backup_waivers'];
  const snapshot = async () => Promise.all(tables.map(t=>query(`select * from ${t}`).then(r=>r.rows)));
  const before = await snapshot(); const s = await read(); expect(s.gates).toEqual({'db-read':{ok:true,reasons:[]},db:{ok:true,reasons:[]}});
  expect(s.epoch).toBe('none'); expect(s.waivers).toEqual({calendar:{audited:false},backup:{audited:false}});
  for (const age of Object.values(s.evidenceAgesMs)) expect(age).toBeGreaterThanOrEqual(0);
  expect(JSON.stringify(s)).not.toContain('SYNTHETIC_PRIVATE_REFERENCE'); expect(JSON.stringify(s)).not.toContain(importId); expect(await snapshot()).toEqual(before);
});
it.each([
  ['full_parity_required', "delete from content_studio_cutover_evidence where name='parity'"],
  ['parity_not_green', "update content_studio_cutover_evidence set payload=jsonb_set(payload,'{samples,library,idsEqual}','false') where name='parity'"],
  ['write_proof_missing', "delete from content_studio_cutover_evidence where name='phase-c'"],
  ['write_proof_expired', "update content_studio_cutover_evidence set at=clock_timestamp()-interval '25 hours' where name='phase-c'"],
  ['phase_c_proof_missing', "update content_studio_cutover_evidence set payload=payload-'privateEvidence' where name='phase-c'"],
  ['rollback_proof_missing', "update content_studio_cutover_evidence set payload=payload||'{\"exact\":false}' where name='rehearsal'"],
  ['backup_proof_missing', "update content_studio_cutover_evidence set payload='{}' where name='backup'"],
  ['gate_unavailable', "update content_studio_cutover_evidence set payload=jsonb_set(payload,'{samples,library,lagMs}','\"SYNTHETIC_PRIVATE_ERROR\"') where name='parity'"],
])('exposes real gate failure %s', async (reason,sql) => {
  await green(); await query(sql); const s = await read(); expect(s.gates.db).toEqual({ok:false,reasons:[reason]}); expect(JSON.stringify(s)).not.toContain('SYNTHETIC_PRIVATE_ERROR');
});
it('exposes the waiver export failure without evidence text; backup receipt requires exact build, latest import and env', async () => {
  await green(); await audit(); vi.stubEnv('CS_BACKUP_GATE_WAIVED','2026-10-25'); resetEnvCache();
  expect((await read()).gates.db).toEqual({ok:false,reasons:['backup_waiver_export_not_exact']});
  expect((await read()).waivers.backup.audited).toBe(true);
  const store = new ContentCutoverStore(options,build); const receipt = await store.backupReceipt();
  expect(receipt).toEqual({status:'backup_waived',waiver:{audited:true,build,auditHash:expect.stringMatching(/^[a-f0-9]{64}$/)}});
  const canonical=(await query('select to_jsonb(w)::text as canonical from content_studio_backup_waivers w')).rows[0]!.canonical as string;
  expect(receipt!.waiver.auditHash).toBe(createHash('sha256').update(canonical).digest('hex'));
  expect(await store.backupReceipt()).toEqual(receipt);
  await query('select content_studio_cutover_waive_backup($1,$2,$3,$4,$5)', ['22222222-2222-4222-8222-222222222222','c'.repeat(40),importId,'2026-10-25',hash]);
  expect(await store.backupReceipt()).toEqual(receipt); // newer audit for another build is never selected
  await query('insert into content_studio_backup_waivers(operation_id,build,import_id,"on",actor_hash) values($1,$2,$3,$4,$5)',
    ['33333333-3333-4333-8333-333333333333',build,'obsolete','2026-10-25',hash]);
  expect(await store.backupReceipt()).toEqual(receipt); // neither is a newer audit for an obsolete import
  expect(await new ContentCutoverStore(options,'d'.repeat(40)).backupReceipt()).toBeNull();
  vi.stubEnv('CS_CONTENT_BACKUP_FOLDER_ID','synthetic_folder'); expect(await store.backupReceipt()).toBeNull(); vi.stubEnv('CS_CONTENT_BACKUP_FOLDER_ID','');
  vi.stubEnv('CS_BACKUP_GATE_WAIVED',''); vi.stubEnv('CS_PARITY_WINDOW_WAIVED','2026-10-25'); expect(await store.backupReceipt()).toBeNull();
  vi.stubEnv('CS_BACKUP_GATE_WAIVED','2026-10-25'); await db.raw.query("update content_studio_backup_waivers set import_id='obsolete'"); expect(await store.backupReceipt()).toBeNull();
});
it('calendar audit is separate; env alone or obsolete evidence never counts', async () => {
  vi.stubEnv('CS_PARITY_WINDOW_WAIVED','2026-10-25'); resetEnvCache(); expect((await read()).waivers.calendar.audited).toBe(false);
  await query("insert into content_studio_shadow_events(event_id,kind,payload) values('11111111-1111-4111-8111-111111111111','imported',$1)",
    [{evidence:{snapshotHash:hash,windowWaiver:{by:'owner',on:'2026-10-25',recordedAt:new Date().toISOString()}}}]);
  expect((await read()).waivers).toEqual({calendar:{audited:true},backup:{audited:false}});
  await query("update content_studio_shadow_events set payload=jsonb_set(payload,'{evidence,snapshotHash}','\"obsolete\"')");
  expect((await read()).waivers.calendar.audited).toBe(false);
  vi.stubEnv('CS_PARITY_WINDOW_WAIVED',''); resetEnvCache(); expect((await read()).waivers.calendar.audited).toBe(false);
});
it.each(['by','on','recordedAt','snapshotHash'])('calendar audit requires durable %s', async field => {
  vi.stubEnv('CS_PARITY_WINDOW_WAIVED','2026-10-25'); resetEnvCache();
  const evidence = {snapshotHash:hash,windowWaiver:{by:'owner',on:'2026-10-25',recordedAt:new Date().toISOString()}};
  if(field==='snapshotHash') evidence.snapshotHash='obsolete';
  else delete evidence.windowWaiver[field as keyof typeof evidence.windowWaiver];
  await query("insert into content_studio_shadow_events(event_id,kind,payload) values('11111111-1111-4111-8111-111111111111','imported',$1)",[{evidence}]);
  expect((await read()).waivers.calendar.audited).toBe(false);
});
it('calendar audit uses the latest imported event, excluding unrelated/newer diagnostics', async () => {
  vi.stubEnv('CS_PARITY_WINDOW_WAIVED','2026-10-25'); resetEnvCache();
  const evidence = {snapshotHash:hash,windowWaiver:{by:'owner',on:'2026-10-25',recordedAt:new Date().toISOString()}};
  await query("insert into content_studio_shadow_events(event_id,kind,payload,at) values('11111111-1111-4111-8111-111111111111','imported',$1,clock_timestamp()-interval '2 minutes')",[{evidence}]);
  await query("insert into content_studio_shadow_events(event_id,kind,payload) values('22222222-2222-4222-8222-222222222222','failed','{}')");
  expect((await read()).waivers.calendar.audited).toBe(true);
  await query("insert into content_studio_shadow_events(event_id,kind,payload) values('33333333-3333-4333-8333-333333333333','imported','{}')");
  expect((await read()).waivers.calendar.audited).toBe(false);
});
it('SQL status refuses malformed build and suppresses unexpected SQL diagnostics', async () => {
  for(const value of [null,'short','A'.repeat(40)]) await expect(query('select content_studio_cutover_status($1)',[value])).rejects.toMatchObject({code:'22023'});
});
it.each(['null','{"ok":false}','{"ok":true,"copy":"SYNTHETIC_PRIVATE_COPY"}'])('SQL wrapper rejects an unexpected gate result %s', async result => {
  try {
    await db.raw.exec(`create or replace function public.content_studio_cutover_gate(p_mode text,p_build text,p_backup_waiver text default null)
      returns jsonb language sql stable security invoker set search_path=pg_catalog,public as $$ select '${result}'::jsonb $$`);
    const s=await read(); expect(s.gates).toEqual({'db-read':{ok:false,reasons:['gate_unavailable']},db:{ok:false,reasons:['gate_unavailable']}});
    expect(JSON.stringify(s)).not.toContain('SYNTHETIC_PRIVATE_COPY');
  } finally { await db.raw.exec(readFileSync('supabase/migrations/20261025000700_content_backup_gate_waiver.sql','utf8')); }
});
it('SQL wrapper translates invalid-gate refusal without returning its text', async () => {
  try {
    await db.raw.exec(`create or replace function public.content_studio_cutover_gate(p_mode text,p_build text,p_backup_waiver text default null)
      returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public as $$ begin raise exception 'invalid gate' using errcode='42501'; end $$`);
    expect((await read()).gates.db).toEqual({ok:false,reasons:['invalid_gate']});
  } finally { await db.raw.exec(readFileSync('supabase/migrations/20261025000700_content_backup_gate_waiver.sql','utf8')); }
});
it('SQL calendar audit refuses a different switch even beside a matching malformed audit', async () => {
  const evidence={snapshotHash:hash,windowWaiver:{by:'owner',on:'other-date',recordedAt:new Date().toISOString()}};
  await query("insert into content_studio_shadow_events(event_id,kind,payload) values('11111111-1111-4111-8111-111111111111','imported',$1)",[{evidence}]);
  const result=(await query('select content_studio_cutover_status($1,null,$2) as s',[build,'other-date'])).rows[0]!.s as {waivers:{calendar:{audited:boolean}}};
  expect(result.waivers.calendar.audited).toBe(false);
});
it.each([['db-read','read'],['db','db'],['sheet','retired']])('reports %s epoch as %s without exposing epoch identifiers', async (mode,expected) => {
  await query('insert into content_studio_cutover_authority(singleton,mode,build,contract,schema_version) values(true,$1,$2,$3,2)',[mode,build,'schema-2:cutover-1']);
  expect((await read()).epoch).toBe(expected);
});
it('evidence for another build/import never masquerades as current evidence', async () => {
  await green(); await query("update content_studio_cutover_evidence set build=$1",['c'.repeat(40)]);
  expect((await read()).evidenceAgesMs).toEqual({parity:null,'phase-c':null,rehearsal:null,backup:null});
  await query('update content_studio_cutover_evidence set build=$1,import_id=$2',[build,'obsolete']); expect((await read()).evidenceAgesMs.parity).toBeNull();
});
it('additive read migration reapplies safely with invoker, pinned search path and service-only ACLs', async () => {
  await db.raw.exec(readFileSync('supabase/migrations/20261025000800_content_cutover_status.sql','utf8'));
  for (const signature of ['content_studio_cutover_status(text,text,text)','content_studio_cutover_backup_receipt(text,text)']) {
    const rows = (await db.raw.query<{prosecdef:boolean;proconfig:string[]}>('select prosecdef,proconfig from pg_proc where oid=$1::regprocedure',[signature])).rows;
    expect(rows[0]!.prosecdef).toBe(false); expect(rows[0]!.proconfig).toEqual(['search_path=pg_catalog, public']);
    for (const role of ['anon','authenticated','service_role']) expect((await db.raw.query<{ok:boolean}>('select has_function_privilege($1,$2,$3) as ok',[role,signature,'EXECUTE'])).rows[0]!.ok).toBe(role==='service_role');
  }
});
it('owner runner consumes the real health/status responses over mock fetch', async () => {
  await green(); const logs:string[]=[]; const states:string[]=[];
  const code = await cutover(['status'],{env:{APP_BASE_URL:'https://synthetic.example'},tty:true,prompt:async ()=>'synthetic-status-cron-secret',log:(s:string)=>logs.push(s),
    store:{open(){},read:()=>({}),save:(s:string)=>states.push(s),log:(s:string)=>states.push(s),close(){}},
    fetcher:async (url:string)=>url.endsWith('/api/health')?health():GET(req())});
  expect(code).toBe(0); expect(logs.join('\n')).toContain('gate db | PASS | server green'); expect(logs.join('\n')).toContain('dpl_synthetic123');
  expect(states.join()).toContain('dpl_synthetic123'); expect(states.join()).not.toContain('synthetic-status-cron-secret');
});
