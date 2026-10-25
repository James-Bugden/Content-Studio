import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtempSync, readFileSync, readdirSync, rmSync, mkdirSync, writeFileSync, symlinkSync, statSync, linkSync, openSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
vi.mock('node:child_process', async importOriginal => ({ ...await importOriginal<typeof import('node:child_process')>(), spawn: vi.fn() }));
vi.mock('node:fs', async importOriginal => {
  const fs=await importOriginal<typeof import('node:fs')>();
  return {...fs,openSync:vi.fn(fs.openSync),chmodSync:vi.fn(fs.chmodSync),mkdirSync:vi.fn(fs.mkdirSync)};
});
import { spawn } from 'node:child_process';
// @ts-expect-error dependency-free Node CLI
import { cutover, privateStore, redact } from '../../scripts/cutover.mjs';
// @ts-expect-error shared dependency-free secret transport
import { command, hiddenPrompt } from '../../scripts/env-setup.mjs';

const secret = 'synthetic-owner-bearer-DO-NOT-LOG';
const sha = 'a'.repeat(40), hash = 'b'.repeat(64);
const base = 'https://deployment.example.com';
const keys = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
const collections = ['library', 'queue', 'ready', 'schedule', 'queue_summary', 'workflow_settings'];
const health = () => ({ ok: true, mode: 'live', commit: sha, capabilities: ['auth','sheet','drive'].map(provider => ({provider, mode:'live',state:'ready'})) });
const status = () => ({ok:true,status:{build:sha,contract:'schema-2:cutover-1',gates:{'db-read':{ok:true,reasons:[]},db:{ok:true,reasons:[]}}}});
const measured = () => ({coverage:'all-rows',build:sha,samples:Object.fromEntries(collections.map(collection => [collection,{collection,idsEqual:true,fields:1,equal:1,blocking:0,lagMs:10,facts:[{privateCopy:'synthetic private copy'}]}]))});
const parity = () => ({ exact:true,counts:{library:1,queue:0,schedule:1,workflow_settings:1},dbHash:hash,sheetHash:hash,differences:[] });
const response = (body: unknown, code = 200) => new Response(JSON.stringify(body),{status:code});
function harness() {
  let data: Record<string, {key: string;status:string;sha:string|null}> = {};
  const logs: string[] = [], files: string[] = [];
  const store = {open:vi.fn(),read:()=>structuredClone(data),save:vi.fn((text:string)=>{files.push(text);data=JSON.parse(text);}),log:vi.fn((text:string)=>files.push(text)),close:vi.fn()};
  const fetcher = vi.fn(async (url:string, init:RequestInit) => {
    if (url.endsWith('/api/health')) return response(health());
    if (url.endsWith('/api/ops/content-cutover') && init.method === 'GET') return response(status());
    if (url.endsWith('/content-export/reconcile')) return response({ok:true,...parity()});
    if (url.endsWith('/content-backup/reconcile')) return response({ok:true,status:'verified',manifestHash:hash,verifiedAt:1});
    const action = JSON.parse(String(init.body)).action;
    return response({ok:true,result:action === 'measure' ? measured() : action === 'backup' ? {status:'verified',manifestHash:hash,verifiedAt:1} : action === 'rollback' ? {readyToFlip:'sheet',writesDisabled:true,parity:parity(),build:sha} : {mode:action === 'activate-read' ? 'db-read' : 'db',build:sha,contract:'schema-2:cutover-1'}});
  });
  const run = vi.fn(async (_file:string,args:string[])=>({ok:true,stdout:args[0] === 'show' ? secret+'\n' : ''}));
  return {env:{APP_BASE_URL:base} as Record<string,string>,tty:true,store,fetcher,run,prompt:vi.fn().mockResolvedValue(secret),confirm:vi.fn().mockResolvedValue('ACTIVATE'),uuid:vi.fn().mockReturnValue(keys[0]),log:(s:string)=>logs.push(s),logs,files,state:()=>data};
}
const mutations = (h:ReturnType<typeof harness>) => h.fetcher.mock.calls.filter(([,i])=>i.method === 'POST' || Boolean(i.headers && (i.headers as Record<string,string>)['Idempotency-Key']));
const roots: string[] = [];
afterEach(()=> { for (const root of roots.splice(0)) rmSync(root,{recursive:true,force:true}); });
beforeEach(()=>vi.clearAllMocks());

describe('owner CLI boundaries',()=>{
  it.each(['status','measure','activate-read','activate-db','backup','rollback','export','all-prepare','smoke'])('prints PASS tables for mocked %s',async action=>{
    const h=harness();
    expect(await cutover([action,...(action.startsWith('activate-')?['--sha',sha]:[])],h)).toBe(0);
    expect(h.logs.join('\n')).toContain('PASS');
    expect(JSON.stringify(h.files)+h.logs.join('\n')).not.toContain(secret);
    expect(JSON.stringify(h.files)).not.toContain('synthetic private copy');
  });
  it.each([[],['unknown'],['status','--secret',secret],['status','--from','file'],['activate-db'],['activate-read','--sha','abc'],['status','--sha',sha,'--sha',sha],['status','--base-url']])('rejects malformed argv without echo %s',async (...args)=>{
    const h=harness();expect(await cutover(args,h)).toBe(1);expect(h.fetcher).not.toHaveBeenCalled();expect(h.logs.join()).not.toContain(secret);
  });
  it.each(['http://deployment.example.com','https://example.com/path','https://example.com/?token=synthetic','https://example.com/#x',['https://synthetic-user','synthetic-password@example.com'].join(':'),undefined])('never guesses or accepts unsafe origin %s',async url=>{
    const h=harness();h.env.APP_BASE_URL=url as string;expect(await cutover(['status'],h)).toBe(1);expect(h.fetcher).not.toHaveBeenCalled();
  });
  it('uses explicit base URL; redirects are prohibited, bearer only in header',async()=>{
    const h=harness();await cutover(['measure','--base-url','https://explicit.example.com'],h);
    for (const [url,init] of h.fetcher.mock.calls) {
      expect(url.startsWith('https://explicit.example.com/')).toBe(true);expect(url).not.toContain(secret);
      expect(init.redirect).toBe('error');expect(init.signal).toBeInstanceOf(AbortSignal);
      expect((init.headers as Record<string,string>).Authorization).toBe('Bearer '+secret);
      expect(JSON.stringify({...init,headers:{}})).not.toContain(secret);
    }
    expect(h.run).not.toHaveBeenCalled();
  });
  it('rejects bearer pasted into origin before HTTP',async()=>{
    const h=harness();h.env.APP_BASE_URL=`https://${secret}.example.com`;expect(await cutover(['smoke'],h)).toBe(1);expect(h.fetcher).not.toHaveBeenCalled();
  });
  it.each(['prompt','lastpass'])('refuses non-TTY %s even with a source available',async source=>{
    const h=harness();h.tty=false;expect(await cutover(['status','--from',source],h)).toBe(1);expect(h.run).not.toHaveBeenCalled();expect(h.prompt).not.toHaveBeenCalled();expect(h.fetcher).not.toHaveBeenCalled();
  });
  it('env is explicit, removed before children, no implicit CRON_SECRET read',async()=>{
    const h=harness();h.tty=false;h.env.CS_CUTOVER_BEARER=secret;h.env.CRON_SECRET='wrong';
    expect(await cutover(['smoke','--from','env'],h)).toBe(0);expect(h.env.CS_CUTOVER_BEARER).toBeUndefined();expect(h.prompt).not.toHaveBeenCalled();expect(h.run).not.toHaveBeenCalled();
    const other=harness();other.tty=false;other.env.CRON_SECRET=secret;expect(await cutover(['status','--from','env'],other)).toBe(1);expect(other.fetcher).not.toHaveBeenCalled();
  });
  it.each(['','has space','line\nbreak','nonascii-測'])('rejects empty or invalid bearer without leaking',async value=>{
    const h=harness();h.prompt.mockResolvedValue(value);expect(await cutover(['smoke'],h)).toBe(1);expect(h.fetcher).not.toHaveBeenCalled();expect(h.logs.join()).toContain('Bearer must be nonempty');expect(h.logs.join()).not.toContain('line\nbreak');
  });
  it('reuses hidden TTY and never echoes typed secret',async()=>{
    const h=harness();const input=Object.assign(new PassThrough(),{isTTY:true,isRaw:false,setRawMode:vi.fn()});
    let printed='';const output={isTTY:true,write:(s:string)=>{printed+=s;}};
    h.prompt.mockImplementation(()=>{const promise=hiddenPrompt('CRON_SECRET',1,1,input,output);queueMicrotask(()=>input.emit('data',Buffer.from(secret+'\r')));return promise;});
    expect(await cutover(['smoke'],h)).toBe(0);expect(printed).not.toContain(secret);expect(input.setRawMode.mock.calls).toEqual([[true],[false]]);
  });
  it('LastPass reads only the fixed vault entry and uses sanitized shared launcher',async()=>{
    const h=harness();h.env.CS_CUTOVER_BEARER=secret;
    expect(await cutover(['smoke','--from','lastpass'],h)).toBe(0);
    expect(h.run.mock.calls).toEqual([['lpass',['status','--quiet']],['lpass',['show','--password','content-studio/CRON_SECRET']]]);
    expect(JSON.stringify(h.run.mock.calls)).not.toContain(secret);expect(h.env.CS_CUTOVER_BEARER).toBeUndefined();
  });
  it.each(['status','show'])('LastPass %s failures suppress all provider output',async failed=>{
    const h=harness();h.run.mockImplementation(async (_f,a)=>({ok:a[0]!==failed,stdout:secret}));
    expect(await cutover(['status','--from','lastpass'],h)).toBe(1);expect(h.logs.join()).not.toContain(secret);expect(h.fetcher).not.toHaveBeenCalled();
  });
  it('child process never inherits cutover bearer or CRON_SECRET, argv or stdin',async()=>{
    const child=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),stdin:new PassThrough(),kill:vi.fn()});
    vi.mocked(spawn).mockImplementationOnce(()=>{queueMicrotask(()=>child.emit('close',0));return child as never;});
    vi.stubEnv('CS_CUTOVER_BEARER',secret);vi.stubEnv('CRON_SECRET',secret);
    try { expect((await command('lpass',['status','--quiet'])).ok).toBe(true); }
    finally { vi.unstubAllEnvs(); }
    const call=vi.mocked(spawn).mock.calls[0]!;expect(JSON.stringify(call)).not.toContain(secret);expect(call[2]?.shell).toBe(false);expect(call[2]?.env?.CS_CUTOVER_BEARER).toBeUndefined();expect(child.stdin.read()).toBeNull();
  });
});

describe('activation admission',()=>{
  it.each(['activate-read','activate-db'])('requires exact deployed SHA for %s',async action=>{
    const h=harness();expect(await cutover([action,'--sha','c'.repeat(40)],h)).toBe(1);expect(mutations(h)).toHaveLength(0);expect(h.confirm).not.toHaveBeenCalled();
  });
  it.each(['activate-read','activate-db'])('requires green target gate for %s',async action=>{
    const h=harness();const fetcher=h.fetcher.getMockImplementation()!;
    h.fetcher.mockImplementation(async (u,i)=> {const s=status();s.status.gates[action === 'activate-read'?'db-read':'db']={ok:false,reasons:['stale_parity','import_lag','contract_mismatch'] as never[]};return u.endsWith('content-cutover')?response(s):fetcher(u,i);});
    expect(await cutover([action,'--sha',sha],h)).toBe(1);expect(mutations(h)).toHaveLength(0);expect(h.confirm).not.toHaveBeenCalled();expect(h.logs.join()).toContain('stale_parity, import_lag, contract_mismatch');
  });
  it.each(['ACTIVATE ','activate','','YES'])('refuses inexact confirmation %s',async answer=>{
    const h=harness();h.confirm.mockResolvedValue(answer);expect(await cutover(['activate-db','--sha',sha],h)).toBe(1);expect(mutations(h)).toHaveLength(0);expect(h.logs.join()).toContain('Rollback command:');
  });
  it('env source cannot bypass interactive activation',async()=>{
    const h=harness();h.tty=false;h.env.CS_CUTOVER_BEARER=secret;expect(await cutover(['activate-db','--sha',sha,'--from','env'],h)).toBe(1);expect(mutations(h)).toHaveLength(0);expect(h.confirm).not.toHaveBeenCalled();
  });
  it.each(['build','contract','gates','unknown','contradiction'])('refuses malformed status %s',async kind=>{
    const h=harness(),fetcher=h.fetcher.getMockImplementation()!;
    h.fetcher.mockImplementation(async(u,i)=>{
      if (!u.endsWith('content-cutover')) return fetcher(u,i);
      const s=status();
      if(kind==='build')s.status.build='d'.repeat(40);
      if(kind==='contract')s.status.contract='other';
      if(kind==='gates')s.status.gates={} as never;
      if(kind==='unknown')s.status.gates.db.ok=undefined as never;
      if(kind==='contradiction')s.status.gates.db.reasons=['stale_parity'] as never;
      return response(s);
    });
    expect(await cutover(['activate-db','--sha',sha],h)).toBe(1);expect(mutations(h)).toHaveLength(0);
  });
  it('rechecks gates after confirmation before mutation',async()=>{
    const h=harness();h.confirm.mockImplementation(async()=>{h.fetcher.mockResolvedValueOnce(response(health())).mockResolvedValueOnce(response({...status(),status:{...status().status,gates:{...status().status.gates,db:{ok:false,reasons:['stale_parity']}}}}));return 'ACTIVATE';});
    expect(await cutover(['activate-db','--sha',sha],h)).toBe(1);expect(mutations(h)).toHaveLength(0);
  });
  it('read activation succeeds with its green gate while write admission remains red',async()=>{
    const h=harness(),f=h.fetcher.getMockImplementation()!;
    h.fetcher.mockImplementation(async(u,i)=>{
      if(u.endsWith('content-cutover')&&i.method==='GET'){const s=status();s.status.gates.db={ok:false,reasons:['stale_parity'] as never};return response(s);}
      return f(u,i);
    });
    expect(await cutover(['activate-read','--sha',sha],h)).toBe(0);expect(mutations(h)).toHaveLength(1);
  });
  it('real merged POST-only route returns 405: status is a blocker, never fabricated green',async()=>{
    const h=harness(),fetcher=h.fetcher.getMockImplementation()!;
    h.fetcher.mockImplementation(async(u,i)=>u.endsWith('content-cutover')&&i.method==='GET'?response({ok:false},405):fetcher(u,i));
    expect(await cutover(['activate-db','--sha',sha],h)).toBe(1);expect(h.logs.join()).toContain('HTTP 405');expect(mutations(h)).toHaveLength(0);
  });
});

describe('retry identity and result guards',()=>{
  it('persists before mutation, retries ambiguous failure with same UUID and rotates after success',async()=>{
    const h=harness(),fetcher=h.fetcher.getMockImplementation()!;let fail=true;
    h.fetcher.mockImplementation(async(u,i)=>{
      if(i.method==='POST') {expect(Object.values(h.state())[0]?.status).toBe('pending');expect(h.store.save).toHaveBeenCalled();if(fail)throw new Error(secret);}
      return fetcher(u,i);
    });
    expect(await cutover(['measure'],h)).toBe(1);expect(Object.values(h.state())[0]?.status).toBe('pending');fail=false;
    h.uuid.mockReturnValue(keys[1]);
    expect(await cutover(['measure'],h)).toBe(0);expect(await cutover(['measure'],h)).toBe(0);
    expect(h.uuid).toHaveBeenCalledTimes(2);
    expect(mutations(h).map(([,i])=>(i.headers as Record<string,string>)['Idempotency-Key'])).toEqual([keys[0],keys[0],keys[1]]);
    expect(h.logs.join()+h.files.join()).not.toContain(secret);
  });
  it('pending SHA change refuses a new identity',async()=>{
    const h=harness();h.fetcher.mockRejectedValueOnce(new Error('offline')); // health fails; next attempt reaches mutation
    await cutover(['measure'],h);const f=h.fetcher.getMockImplementation()!;
    h.fetcher.mockImplementation(async(u,i)=>{if(i.method==='POST')throw new Error('lost');return f(u,i);});
    await cutover(['measure'],h);const before=mutations(h).length;
    expect(await cutover(['measure','--sha',sha],h)).toBe(1);expect(mutations(h)).toHaveLength(before);
  });
  it.each(['missing collection','ids','blocking','ratio','lag','unknown lag','wrong collection','coverage','build','different build'])('refuses incomplete measurement: %s',async kind=>{
    const h=harness(),f=h.fetcher.getMockImplementation()!;const m=measured();
    const s=m.samples.library!;
    if(kind==='missing collection')delete m.samples.queue;
    if(kind==='ids')s.idsEqual=false;if(kind==='blocking')s.blocking=1;if(kind==='ratio')s.equal=0;
    if(kind==='lag')s.lagMs=900001;if(kind==='unknown lag')s.lagMs=null as never;
    if(kind==='wrong collection')s.collection='queue';if(kind==='coverage')m.coverage='sample';if(kind==='build')m.build='x';if(kind==='different build')m.build='d'.repeat(40);
    h.fetcher.mockImplementation(async(u,i)=>i.method==='POST'?response({ok:true,result:m}):f(u,i));
    expect(await cutover(['measure'],h)).toBe(1);expect(Object.values(h.state())[0]?.status).toBe('pending');
  });
  it.each(['export','rollback'])('refuses inexact %s without retaining private payload',async action=>{
    const h=harness(),f=h.fetcher.getMockImplementation()!;const p={...parity(),exact:false,differences:[{copy:secret}]};
    h.fetcher.mockImplementation(async(u,i)=>u.endsWith('/api/health')?f(u,i):response(action==='export'?{ok:true,...p}:{ok:true,result:{readyToFlip:'sheet',writesDisabled:true,build:sha,parity:p}}));
    expect(await cutover([action],h)).toBe(1);expect(h.files.join()+h.logs.join()).not.toContain(secret);
  });
  it('export requires an affirmative exact verdict even when counts and hashes match',async()=>{
    const h=harness(),f=h.fetcher.getMockImplementation()!;h.fetcher.mockImplementation(async(u,i)=>u.endsWith('/content-export/reconcile')?response({ok:true,...parity(),exact:false}):f(u,i));
    expect(await cutover(['export'],h)).toBe(1);
  });
  it.each(['hash','counts','differences','freeze','ready','build','different build'])('rollback refuses invalid %s',async kind=>{
    const h=harness(),f=h.fetcher.getMockImplementation()!;const r={readyToFlip:'sheet',writesDisabled:true,build:sha,parity:parity()};
    if(kind==='hash')r.parity.sheetHash='c'.repeat(64);if(kind==='counts')r.parity.counts={} as never;
    if(kind==='differences')r.parity.differences=[{}] as never;if(kind==='freeze')r.writesDisabled=false;if(kind==='ready')r.readyToFlip='db';if(kind==='build')r.build='bad';if(kind==='different build')r.build='d'.repeat(40);
    h.fetcher.mockImplementation(async(u,i)=>i.method==='POST'?response({ok:true,result:r}):f(u,i));expect(await cutover(['rollback'],h)).toBe(1);
  });
  it.each(['mode','build','contract'])('refuses invalid activation result %s',async kind=>{
    const h=harness(),f=h.fetcher.getMockImplementation()!;
    h.fetcher.mockImplementation(async(u,i)=>i.method==='POST'?response({ok:true,result:{mode:'db',build:sha,contract:'schema-2:cutover-1',[kind]:'bad'}}):f(u,i));expect(await cutover(['activate-db','--sha',sha],h)).toBe(1);
  });
  it('backup waiver requires server audited proof bound to build',async()=>{
    for(const audited of [false,true]) {
      const h=harness(),f=h.fetcher.getMockImplementation()!;
      h.fetcher.mockImplementation(async(u,i)=>i.method==='POST'?response({ok:true,result:{status:'backup_waived',waiver:{audited,build:sha,auditHash:hash}}}):f(u,i));
      expect(await cutover(['backup'],h)).toBe(audited?0:1);if(audited)expect(h.logs.join()).toContain('backup_waived');
    }
  });
  it.each(['hash','build','audit'])('backup refuses invalid waiver %s',async kind=>{
    const h=harness(),f=h.fetcher.getMockImplementation()!;const waiver={audited:true,build:sha,auditHash:hash};
    if(kind==='hash')waiver.auditHash='bad';if(kind==='build')waiver.build='d'.repeat(40);if(kind==='audit')waiver.audited=false;
    h.fetcher.mockImplementation(async(u,i)=>i.method==='POST'?response({ok:true,result:{status:'backup_waived',waiver}}):f(u,i));expect(await cutover(['backup'],h)).toBe(1);
  });
  it('backup refuses an unverified manifest',async()=>{
    const h=harness(),f=h.fetcher.getMockImplementation()!;h.fetcher.mockImplementation(async(u,i)=>i.method==='POST'?response({ok:true,result:{status:'verified',manifestHash:'bad'}}):f(u,i));expect(await cutover(['backup'],h)).toBe(1);
  });
  it('scheduled backup uses the merged GET contract and still sends a persisted key (server uses daily key)',async()=>{
    const h=harness();expect(await cutover(['backup','--scheduled'],h)).toBe(0);expect(mutations(h)[0]?.[0]).toBe(base+'/api/ops/content-backup/reconcile');expect(mutations(h)[0]?.[1].method).toBe('GET');
  });
  it.each([401,403,409,429,500,503])('clear HTTP %s failure, typed reasons only, key retained',async code=>{
    const h=harness(),f=h.fetcher.getMockImplementation()!;
    h.fetcher.mockImplementation(async(u,i)=>i.method==='POST'?response({ok:false,code:'FORBIDDEN',message:secret,details:{reason:'cron_auth',copy:secret}},code):f(u,i));
    expect(await cutover(['measure'],h)).toBe(1);expect(h.logs.join()).toContain(`HTTP ${code}: FORBIDDEN, cron_auth`);expect(h.logs.join()+h.files.join()).not.toContain(secret);expect(Object.values(h.state())[0]?.status).toBe('pending');
  });
  it('timeout fails clearly and keeps request UUID',async()=>{
    const h=harness(),f=h.fetcher.getMockImplementation()!;
    h.fetcher.mockImplementation(async(u,i)=>{if(i.method!=='POST')return f(u,i);return await new Promise((_r,reject)=>{i.signal!.addEventListener('abort',()=>reject(new Error(secret)),{once:true});});});
    expect(await cutover(['measure'],{...h,timeoutMs:5})).toBe(1);expect(h.logs.join()).toContain('Network failure or timeout');expect(Object.values(h.state())[0]?.status).toBe('pending');
  });
  it('invalid JSON, ok:false, unknown error, bad UUID, corrupt state and disk failure never succeed',async()=>{
    for(const kind of ['json','false','throw','uuid','state','save','log','close','open']) {
      const h=harness(),f=h.fetcher.getMockImplementation()!;
      if(kind==='json')h.fetcher.mockImplementation(async(u,i)=>i.method==='POST'?new Response('not-json'):f(u,i));
      if(kind==='false')h.fetcher.mockImplementation(async(u,i)=>i.method==='POST'?response({ok:false,message:secret}):f(u,i));
      if(kind==='throw')h.prompt.mockRejectedValue(new Error(secret));if(kind==='uuid')h.uuid.mockReturnValue('bad');
      if(kind==='state')h.store.read=()=>({slot:{key:'bad',status:'pending',sha:null}});
      if(['save','log','close','open'].includes(kind))h.store[kind as 'save'].mockImplementation(()=>{throw new Error(secret);});
      expect(await cutover(['measure'],h),kind).toBe(1);expect(h.logs.join()+h.files.join(),kind).not.toContain(secret);
      if(kind==='open')expect(h.store.log).not.toHaveBeenCalled();
    }
  });
  it('never persists a credential that overlaps a generated request key',async()=>{
    const h=harness();h.prompt.mockResolvedValue(keys[0]);expect(await cutover(['measure'],h)).toBe(1);
    expect(h.store.save).not.toHaveBeenCalled();expect(mutations(h)).toHaveLength(0);expect(h.files.join()).not.toContain(keys[0]);
  });
  it('projects counts only; unknown private fields never enter logs',async()=>{
    const h=harness(),f=h.fetcher.getMockImplementation()!;h.fetcher.mockImplementation(async(u,i)=>u.endsWith('/content-export/reconcile')?response({ok:true,...parity(),counts:{...parity().counts,copy:'private synthetic copy'},post:'private synthetic copy'}):f(u,i));
    expect(await cutover(['export'],h)).toBe(0);expect(h.files.join()).not.toContain('private synthetic copy');
  });
  it('redacts raw, URL-encoded and JSON-escaped values',()=>{
    for(const value of [secret,encodeURIComponent(secret),JSON.stringify(secret).slice(1,-1)])expect(redact(value,secret)).toBe('[REDACTED]');
    expect(redact(encodeURIComponent('synthetic/secret'),'synthetic/secret')).toBe('[REDACTED]');
  });
  it.each(['mode','sha','capabilities','duplicate','missing','fake','unavailable'])('smoke refuses bad health %s',async kind=>{
    const h=harness(),v=health();if(kind==='mode')v.mode='fake';if(kind==='sha')v.commit='bad';if(kind==='capabilities')v.capabilities=null as never;
    if(kind==='duplicate')v.capabilities.push(v.capabilities[0]!);if(kind==='missing')v.capabilities=[];if(kind==='fake')v.capabilities[0]!.mode='fake';if(kind==='unavailable')v.capabilities[0]!.state='not_configured';
    h.fetcher.mockResolvedValue(response(v));expect(await cutover(['smoke'],h)).toBe(1);expect(mutations(h)).toHaveLength(0);
    if(['duplicate','missing','fake','unavailable'].includes(kind))expect(h.logs.join()).toContain('Required read capability is unavailable or ambiguous');
  });
  it('measurement cannot proceed with missing health capabilities',async()=>{
    const h=harness(),f=h.fetcher.getMockImplementation()!;h.fetcher.mockImplementation(async(u,i)=>u.endsWith('/api/health')?response({...health(),capabilities:null}):f(u,i));
    expect(await cutover(['measure'],h)).toBe(1);expect(mutations(h)).toHaveLength(0);
  });
});

describe('private durable files',()=>{
  function directory(){const root=mkdtempSync(join(tmpdir(),'cs-owner-cutover-'));roots.push(root);return root;}
  it('writes atomic secret-free state/log and locks overlapping processes',async()=>{
    const root=directory(),store=privateStore(root,vi.fn(),'linux');await store.open();
    store.save(JSON.stringify({operation:keys[0]}));store.log(JSON.stringify({timestamp:'2026-10-25T00:00:00Z',sha,counts:{library:1}}));
    expect(chmodSync).toHaveBeenCalledWith(root,0o700);
    expect(openSync).toHaveBeenCalledWith(join(root,'state.json.pending'),expect.any(Number),0o600);
    expect(mkdirSync).toHaveBeenCalledWith(root,{recursive:true,mode:0o700});
    expect(store.read()).toEqual({operation:keys[0]});const second=privateStore(root,vi.fn(),'linux');await expect(second.open()).rejects.toThrow('lock');
    expect(readdirSync(root).some(f=>f.endsWith('.pending'))).toBe(false);
    for(const file of readdirSync(root).filter(f=>f.endsWith('.json')))expect(readFileSync(join(root,file),'utf8')).not.toContain(secret);
    if(process.platform!=='win32'){expect(statSync(root).mode&0o077).toBe(0);expect(statSync(join(root,'state.json')).mode&0o077).toBe(0);}
    store.close();
  });
  it('refuses a symlinked directory before state IO',async()=>{
    const root=directory(),target=join(root,'target');mkdirSync(target);symlinkSync(target,join(root,'link'),'junction');
    try{await expect(privateStore(join(root,'link','nested'),vi.fn(),'linux').open()).rejects.toThrow('path refused');}
    finally{ // unlink junction before recursive scratch cleanup
      if(process.platform==='win32'){const {execFileSync}=await import('node:child_process');execFileSync('cmd',['/c','rmdir',join(root,'link')]);}
      else {const {unlinkSync}=await import('node:fs');unlinkSync(join(root,'link'));}
    }
  });
  it('refuses state symlinks, corrupt JSON and protects Windows ACL before writing',async()=>{
    const root=directory();writeFileSync(join(root,'state.json'),'bad');const store=privateStore(root,vi.fn(),'linux');await store.open();expect(()=>store.read()).toThrow();store.close();
    const run=vi.fn().mockResolvedValueOnce({ok:true,stdout:'"synthetic-owner","S-1-5-21-111-222-333-1001"'}).mockResolvedValueOnce({ok:true,stdout:''}).mockResolvedValueOnce({ok:true,stdout:'synthetic-owner:(F)'}).mockResolvedValue({ok:true,stdout:'synthetic-owner:(I)(F)'});
    const windows=privateStore(root,run,'win32');await windows.open();expect(run.mock.calls[1]?.[1]).toContain('/inheritance:r');expect(run.mock.calls[0]?.[0].replaceAll('\\','/')).toMatch(/System32\/whoami\.exe$/);expect(run.mock.calls[1]?.[0].replaceAll('\\','/')).toMatch(/System32\/icacls\.exe$/);windows.close();
    for(const output of ['Everyone:(F)','BUILTIN\\Users:(RX)','Authenticated Users:(M)']){
      const bad=vi.fn().mockResolvedValueOnce({ok:true,stdout:'"synthetic-owner","S-1-5-21-111-222-333-1001"'}).mockResolvedValueOnce({ok:true}).mockResolvedValueOnce({ok:true,stdout:output});await expect(privateStore(root,bad,'win32').open()).rejects.toThrow('broad ACL');
    }
  });
  it('permission and local state failures prevent every HTTP call',async()=>{
    const h=harness();h.store.open.mockRejectedValue(new Error(secret));expect(await cutover(['measure'],h)).toBe(1);expect(h.fetcher).not.toHaveBeenCalled();expect(h.logs.join()).not.toContain(secret);
  });
  it('refuses hard-linked state and owner ACL failures',async()=>{
    const root=directory();writeFileSync(join(root,'original'),'{}');linkSync(join(root,'original'),join(root,'state.json'));
    const store=privateStore(root,vi.fn(),'linux');await store.open();expect(()=>store.read()).toThrow('path refused');store.close();
    for(const stage of ['identity','grant']){
      const run=vi.fn().mockResolvedValueOnce({ok:stage!=='identity',stdout:'"synthetic-owner","S-1-5-21-111-222-333-1001"'}).mockResolvedValueOnce({ok:stage!=='grant',stdout:''});
      await expect(privateStore(root,run,'win32').open()).rejects.toThrow('Cannot protect');
    }
  });
});
