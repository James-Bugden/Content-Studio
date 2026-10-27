import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const session = vi.hoisted(() => ({ sub: '100000000000000000001' as string | null }));
vi.mock('@/lib/auth/config', () => ({ auth: async () => session.sub ? { user: { id: session.sub } } : null }));
import { requireMutation } from '@/lib/auth';
import { resetEnvCache } from '@/lib/env';
import { resetServices } from '@/application/container';
import { POST as draft } from '@/app/api/library/[libraryId]/draft/route';
import { POST as typefully } from '@/app/api/schedule/[contentId]/typefully/create/route';

const env = { CS_DATA_MODE: 'live', CS_CONTENT_STORE: 'db-read', CS_CONTENT_READ_ENABLED: 'true', CS_CONTENT_DB_ENABLED: 'true', CS_CONTENT_WRITE_ENABLED: 'false',
  CS_CONTENT_BACKUP_FOLDER_ID: 'synthetic_backup_folder', AUTH_SECRET: 'synthetic-auth-secret-freeze-000000000', AUTH_GOOGLE_ID: 'synthetic-client', AUTH_GOOGLE_SECRET: 'synthetic-secret',
  CS_OWNER_GOOGLE_SUB: '100000000000000000001', APP_BASE_URL: 'https://synthetic.example',
  SUPABASE_READ_MODEL_URL: 'https://synthetic.supabase.co', SUPABASE_READ_MODEL_SERVICE_KEY: 'synthetic-service-key-freeze', SUPABASE_READ_MODEL_SOURCE_KEY: 'synthetic_source' };
beforeEach(() => { for (const [k,v] of Object.entries(env)) vi.stubEnv(k,v); session.sub=env.CS_OWNER_GOOGLE_SUB; resetEnvCache(); resetServices(); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); resetEnvCache(); resetServices(); });
const request = (path: string) => new Request(`https://synthetic.example${path}`, { method: 'POST', headers: { origin: 'https://synthetic.example' } });
it.each(['db-read','db'])('freezes %s before a provider-first action enters its application saga', async mode => {
  vi.stubEnv('CS_CONTENT_STORE',mode); resetEnvCache();
  const fetch = vi.fn(); vi.stubGlobal('fetch',fetch);
  for (const path of ['/api/library/SYN-L001/draft','/api/schedule/SYN-001/typefully/create','/api/queue','/api/assets']) {
    await expect(requireMutation(request(path))).rejects.toMatchObject({code:'FORBIDDEN',details:{reason:'rollback_read_only'}});
  }
  const result=await draft(request('/api/library/SYN-L001/draft'), {params:Promise.resolve({libraryId:'SYN-L001'})});
  expect(result.status).toBe(403);
  expect((await typefully(request('/api/schedule/SYN-001/typefully/create'), {params:Promise.resolve({contentId:'SYN-001'})})).status).toBe(403);
  expect(fetch).not.toHaveBeenCalled();
});
it('retains final import/parity and independent Replies authentication while Content is frozen', async () => {
  for (const path of ['/api/ops/sheet-mirror','/api/ops/sheet-mirror/parity','/api/replies/sessions']) expect(await requireMutation(request(path))).toMatchObject({role:'owner'});
  session.sub=null;
  await expect(requireMutation(request('/api/ops/sheet-mirror'))).rejects.toMatchObject({code:'AUTH_REQUIRED'});
});
it('admits owner mutations with DB enabled alone and no cutover service', async () => {
  vi.stubEnv('CS_CONTENT_STORE','db'); vi.stubEnv('CS_CONTENT_WRITE_ENABLED',undefined); resetEnvCache();
  expect(await requireMutation(request('/api/schedule/SYN-001/typefully/create'))).toMatchObject({role:'owner'});
});
it.each(['sheet','db-shadow'])('honours the freeze in %s during flag round trips', async mode => {
  vi.stubEnv('CS_CONTENT_STORE',mode); resetEnvCache();
  await expect(requireMutation(request('/api/library/SYN-L001/draft'))).rejects.toMatchObject({code:'FORBIDDEN',details:{reason:'rollback_read_only'}});
});
