import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const services=vi.hoisted(()=>vi.fn());
vi.mock('@/application/container',()=>({getServices:services}));
import { readOwnerCutoverStatus, readCutoverStatus } from '@/application/cutover-status';
import { resetEnvCache, serverEnv } from '@/lib/env';
import { cutoverStatus } from '../../fixtures/cutover';

beforeEach(()=>{
  vi.clearAllMocks();
  for(const [k,v] of Object.entries({CS_DATA_MODE:'fake',CS_CONTENT_STORE:'db-shadow',CS_COMMIT_SHA:'a'.repeat(40),VERCEL_GIT_COMMIT_SHA:'',
    SUPABASE_READ_MODEL_URL:'https://synthetic.supabase.co',SUPABASE_READ_MODEL_SERVICE_KEY:'synthetic-service-key'})) vi.stubEnv(k,v);
  resetEnvCache();
});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();resetEnvCache();});
it('fake owner status is explicitly synthetic and always red, with no provider read or activation adapter',async()=>{
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
  services.mockReturnValue({contentParity:{lastImport:Date.now()-1000}});
  const status=await readOwnerCutoverStatus(serverEnv());
  expect(status.synthetic).toBe(true);expect(status.build).toBe('0'.repeat(40));
  expect(status.gates).toEqual({'db-read':{ok:false,reasons:['gate_unavailable']},db:{ok:false,reasons:['gate_unavailable']}});
  expect(status.lastImportAgeMs).toBeGreaterThanOrEqual(1000);expect(fetcher).not.toHaveBeenCalled();
  expect(status.waivers).toEqual({calendar:{audited:false},backup:{audited:false}});
  await expect(readCutoverStatus(serverEnv())).rejects.toMatchObject({code:'CONFIG_MISSING'});
});
it('fake preview without an import reports unknown age',async()=>{
  services.mockReturnValue({});expect((await readOwnerCutoverStatus(serverEnv())).lastImportAgeMs).toBeNull();
});
it.each([false,true])('live owner status projects only an import age; timestamp read failure is unavailable: %s',async failed=>{
  vi.stubEnv('CS_DATA_MODE','live');resetEnvCache();
  const fetcher=vi.fn(async(url:string)=>{
    if(url.includes('/rpc/')) return Response.json(cutoverStatus());
    expect(url).toContain('content_studio_import_runs?select=at&order=at.desc,operation_id.desc&limit=1');
    if(failed) throw new Error('SYNTHETIC_PRIVATE_PROVIDER_TEXT');
    return Response.json([{at:new Date(Date.now()-1000).toISOString(),id:'SYNTHETIC_PRIVATE_ID',copy:'SYNTHETIC_PRIVATE_COPY'}]);
  });vi.stubGlobal('fetch',fetcher);
  const status=await readOwnerCutoverStatus(serverEnv());
  if(failed) expect(status.lastImportAgeMs).toBeNull();else expect(status.lastImportAgeMs).toBeGreaterThanOrEqual(1000);
  expect(JSON.stringify(status)).not.toContain('SYNTHETIC_PRIVATE');expect(services).not.toHaveBeenCalled();
  expect(fetcher).toHaveBeenCalledTimes(2);
});
