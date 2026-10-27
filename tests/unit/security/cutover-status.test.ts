import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('node:crypto', async original => { const crypto = await original<typeof import('node:crypto')>(); return { ...crypto, timingSafeEqual: vi.fn(crypto.timingSafeEqual) }; });
import { timingSafeEqual } from 'node:crypto';
import { GET, PUT, PATCH, DELETE, HEAD, OPTIONS } from '@/app/api/ops/content-cutover/route';
import { resetEnvCache } from '@/lib/env';
import { CUTOVER_REASONS } from '@/application/cutover-status';
import { ContentCutoverStore } from '@/integrations/supabase/content-cutover-store';

const build = 'a'.repeat(40), secret = 'synthetic-cutover-status-bearer';
const snapshot = () => ({ epoch: 'none', gates: { 'db-read': { ok: true, reasons: [] }, db: { ok: false, reasons: ['write_proof_missing'] } },
  evidenceAgesMs: { parity: 10, 'phase-c': null, rehearsal: null, backup: null }, waivers: { calendar: { audited: false }, backup: { audited: false } },
  privateEvidence: 'SYNTHETIC_PRIVATE_EVIDENCE', contentId: 'SYNTHETIC_CONTENT_ID', copy: 'SYNTHETIC_COPY' });
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
const request = (authorization: string | null = `Bearer ${secret}`, suffix = '') => new Request(`https://synthetic.example/api/ops/content-cutover${suffix}`,
  { headers: authorization === null ? {} : { authorization } });
beforeEach(() => {
  vi.clearAllMocks();
  for (const [k,v] of Object.entries({ CS_DATA_MODE: 'live', CS_CONTENT_STORE: 'sheet', CRON_SECRET: secret, CS_COMMIT_SHA: build,
    VERCEL_GIT_COMMIT_SHA: '', VERCEL_DEPLOYMENT_ID: 'dpl_synthetic123', SUPABASE_READ_MODEL_URL: 'https://synthetic.supabase.co',
    SUPABASE_READ_MODEL_SERVICE_KEY: 'synthetic-status-service-key', CS_CONTENT_WRITE_ENABLED: 'false', CS_BACKUP_GATE_WAIVED: '', CS_CONTENT_BACKUP_FOLDER_ID: '' })) vi.stubEnv(k,v);
  resetEnvCache(); fetcher = vi.fn<typeof fetch>(async () => Response.json(snapshot())); vi.stubGlobal('fetch',fetcher);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); resetEnvCache(); });

it.each(['Bearer wrong', 'bearer synthetic-cutover-status-bearer', 'Bearer '+secret+'extra'])('authenticates before any read using fixed-size constant-time compare (%s)', async header => {
  const res = await GET(request(header)); expect(res.status).toBe(403); expect(fetcher).not.toHaveBeenCalled();
  expect(timingSafeEqual).toHaveBeenCalledOnce();
  const [a,b] = vi.mocked(timingSafeEqual).mock.calls[0]!; expect(a.byteLength).toBe(32); expect(b.byteLength).toBe(32);
  expect(res.headers.get('cache-control')).toBe('private, no-store, max-age=0');
});
it('missing cron configuration refuses without a provider read', async () => {
  vi.stubEnv('CRON_SECRET',''); resetEnvCache(); expect((await GET(request())).status).toBe(403); expect(fetcher).not.toHaveBeenCalled();
  expect((await GET(request('Bearer undefined'))).status).toBe(403); expect(fetcher).not.toHaveBeenCalled();
});
it('refuses invalid platform deployment metadata without returning its text', async () => {
  vi.stubEnv('VERCEL_DEPLOYMENT_ID','SYNTHETIC_PRIVATE_METADATA'); resetEnvCache(); const res=await GET(request());
  expect(res.status).toBe(500); expect(await res.text()).not.toContain('SYNTHETIC_PRIVATE_METADATA'); expect(fetcher).not.toHaveBeenCalled();
});
it('reads only the server-built RPC, strips unknown fields recursively, needs no idempotency key', async () => {
  const input = snapshot(); Object.assign(input.waivers.backup, { secret }); fetcher.mockResolvedValueOnce(Response.json(input));
  const res = await GET(request()); expect(res.status).toBe(200); expect(res.headers.get('cache-control')).toBe('private, no-store, max-age=0');
  const body = await res.json(); expect(body.status).toEqual({ build, deploymentId: 'dpl_synthetic123', store: 'sheet', contract: 'schema-2:cutover-1',
    writesDisabled: true, epoch: 'none', gates: input.gates, evidenceAgesMs: input.evidenceAgesMs, waivers: { calendar: { audited: false }, backup: { audited: false } } });
  expect(JSON.stringify(body)).not.toMatch(/SYNTHETIC_|secret/);
  expect(fetcher).toHaveBeenCalledOnce(); const [url,init] = fetcher.mock.calls[0]!;
  expect(url).toBe('https://synthetic.supabase.co/rest/v1/rpc/content_studio_cutover_status');
  expect(JSON.parse(String(init?.body))).toEqual({ p_build: build, p_backup_waiver: null, p_calendar_waiver: null }); expect(init?.cache).toBe('no-store');
});
it.each(['?build=bad','?copy=synthetic'])('rejects caller inputs %s', async suffix => {
  expect((await GET(request(undefined,suffix))).status).toBe(400); expect(fetcher).not.toHaveBeenCalled();
});
it('rejects caller content headers', async () => {
  const req = request(); req.headers.set('Content-Type','application/json'); expect((await GET(req)).status).toBe(400); expect(fetcher).not.toHaveBeenCalled();
});
it('rejects a body supplied by a nonstandard GET transport', async () => {
  const req = request(); Object.defineProperty(req,'body',{value:new ReadableStream()});
  expect((await GET(req)).status).toBe(400); expect(fetcher).not.toHaveBeenCalled();
});
it.each([PUT,PATCH,DELETE,HEAD,OPTIONS])('refuses unsupported methods with private/no-store', async handler => {
  const res = handler(); expect(res.status).toBe(405); expect(res.headers.get('cache-control')).toContain('private, no-store'); expect(fetcher).not.toHaveBeenCalled();
});
it.each(CUTOVER_REASONS)('exposes named gate reason %s without provider text', async reason => {
  const input = snapshot(); input.gates.db = { ok: false, reasons: [reason] }; fetcher.mockResolvedValueOnce(Response.json(input));
  expect((await (await GET(request())).json()).status.gates.db).toEqual({ ok: false, reasons: [reason] });
});
it.each(['build','fake','missing-db','missing-key','schema','provider','contradiction','unknown-reason','age'])('fails closed/redacted on %s', async fault => {
  if (fault==='build') vi.stubEnv('CS_COMMIT_SHA','short');
  if (fault==='fake') vi.stubEnv('CS_DATA_MODE','fake');
  if (fault==='missing-db') vi.stubEnv('SUPABASE_READ_MODEL_URL','');
  if (fault==='missing-key') vi.stubEnv('SUPABASE_READ_MODEL_SERVICE_KEY','');
  if (fault==='schema') fetcher.mockResolvedValueOnce(Response.json({ copy: 'SYNTHETIC_COPY' }));
  if (fault==='provider') fetcher.mockRejectedValueOnce(new Error(secret+'SYNTHETIC_COPY'));
  const input = snapshot();
  if (fault==='contradiction') input.gates.db.ok=true;
  if (fault==='unknown-reason') input.gates.db.reasons=['SYNTHETIC_COPY'];
  if (fault==='age') input.evidenceAgesMs.parity=-1;
  if (['contradiction','unknown-reason','age'].includes(fault)) fetcher.mockResolvedValueOnce(Response.json(input));
  resetEnvCache(); const res = await GET(request()); expect(res.status).toBeGreaterThanOrEqual(400); const text = await res.text(); expect(text).not.toContain(secret); expect(text).not.toContain('SYNTHETIC_COPY');
});
it('uses the platform build first, passes separate waiver switches, and disables backup waiver with a folder', async () => {
  vi.stubEnv('VERCEL_GIT_COMMIT_SHA','b'.repeat(40)); vi.stubEnv('CS_BACKUP_GATE_WAIVED','2026-10-25'); vi.stubEnv('CS_PARITY_WINDOW_WAIVED','2026-10-25'); resetEnvCache();
  expect((await (await GET(request())).json()).status.build).toBe('b'.repeat(40));
  expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body))).toMatchObject({ p_backup_waiver: '2026-10-25', p_calendar_waiver: '2026-10-25' });
  vi.stubEnv('CS_CONTENT_BACKUP_FOLDER_ID','synthetic_folder'); resetEnvCache(); await GET(request());
  expect(JSON.parse(String(fetcher.mock.calls[1]![1]?.body)).p_backup_waiver).toBeNull();
});
it.each(['calendar','backup'])('passes the %s switch independently', async kind => {
  vi.stubEnv('CS_PARITY_WINDOW_WAIVED',kind==='calendar'?'2026-10-25':'');
  vi.stubEnv('CS_BACKUP_GATE_WAIVED',kind==='backup'?'2026-10-25':''); resetEnvCache(); await GET(request());
  expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body))).toMatchObject({p_calendar_waiver:kind==='calendar'?'2026-10-25':null,p_backup_waiver:kind==='backup'?'2026-10-25':null});
});
it.each(['epoch','gate-type','reason-array','false-empty','age-null','age-large','age-fraction','calendar','backup'])('rejects malformed aggregate %s', async fault => {
  const input = snapshot();
  if(fault==='epoch') input.epoch='SYNTHETIC_COPY';
  if(fault==='gate-type') { input.gates.db.ok='true' as never; input.gates.db.reasons=[]; }
  if(fault==='reason-array') input.gates.db.reasons='SYNTHETIC_COPY' as never;
  if(fault==='false-empty') input.gates.db.reasons=[];
  if(fault==='age-null') input.evidenceAgesMs=null as never;
  if(fault==='age-large') input.evidenceAgesMs.parity=Number.MAX_SAFE_INTEGER+1;
  if(fault==='age-fraction') input.evidenceAgesMs.parity=.5;
  if(fault==='calendar') input.waivers.calendar.audited='true' as never;
  if(fault==='backup') input.waivers.backup=null as never;
  fetcher.mockResolvedValueOnce(Response.json(input)); const res=await GET(request()); expect(res.status).toBe(500); expect(await res.text()).not.toContain('SYNTHETIC_COPY');
});
it.each(['sheet','db-shadow','db-read'])('reports effective local freeze in legacy %s', async mode => {
  vi.stubEnv('CS_CONTENT_STORE',mode); vi.stubEnv('CS_CONTENT_READ_ENABLED','true'); vi.stubEnv('CS_CONTENT_DB_ENABLED','true');
  vi.stubEnv('SUPABASE_READ_MODEL_SOURCE_KEY','synthetic_source'); vi.stubEnv('CS_BACKUP_GATE_WAIVED','2026-10-25');
  for (const flag of ['', 'false','true']) {
    vi.stubEnv('CS_CONTENT_WRITE_ENABLED',flag); resetEnvCache(); const body=await (await GET(request())).json();
    expect(body.status.writesDisabled).toBe(flag==='false');
  }
});
it('refuses the retired cutover status in db mode without a gate request', async () => {
  vi.stubEnv('CS_CONTENT_STORE','db'); vi.stubEnv('CS_CONTENT_DB_ENABLED','true'); resetEnvCache();
  expect((await GET(request())).status).toBe(403);
  expect(fetcher).not.toHaveBeenCalled();
});
it.each(['status','audited','build','hash'])('refuses malformed backup receipt %s', async fault => {
  const receipt={status:'backup_waived',waiver:{audited:true,build,auditHash:'a'.repeat(64)}};
  if(fault==='status') receipt.status='verified';
  if(fault==='audited') receipt.waiver.audited=false;
  if(fault==='build') receipt.waiver.build='b'.repeat(40);
  if(fault==='hash') receipt.waiver.auditHash='bad';
  fetcher.mockResolvedValueOnce(Response.json(receipt));
  await expect(new ContentCutoverStore({url:'https://synthetic.supabase.co',serviceKey:'synthetic-status-service-key'},build).backupReceipt()).rejects.toBeDefined();
});
