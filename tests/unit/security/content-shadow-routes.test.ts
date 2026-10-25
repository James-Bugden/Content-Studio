import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const session = vi.hoisted(() => ({ sub: null as string | null }));
vi.mock('@/lib/auth/config', () => ({ auth: async () => session.sub ? { user: { id: session.sub } } : null }));
import { POST } from '@/app/api/ops/sheet-mirror/route';
import { GET } from '@/app/api/ops/sheet-mirror/reconcile/route';
import { resetEnvCache } from '@/lib/env';
import { resetServices } from '@/application/container';

const owner = '100000000000000000001', viewer = '100000000000000000002';
const cron = 'synthetic-cron-secret-197';
let fetchBoundary: ReturnType<typeof vi.fn>;
beforeEach(() => {
  const env = { CS_DATA_MODE: 'live', CS_CONTENT_STORE: 'db-shadow', AUTH_SECRET: 'synthetic-auth-secret-197-000000000000', AUTH_GOOGLE_ID: 'synthetic-client', AUTH_GOOGLE_SECRET: 'synthetic-secret',
    CS_OWNER_GOOGLE_SUB: owner, CS_VIEWER_GOOGLE_SUBS: viewer, APP_BASE_URL: 'https://synthetic.example', CRON_SECRET: cron,
    GOOGLE_SERVICE_ACCOUNT_EMAIL: 'svc@example.com', GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: 'synthetic-key', CS_SHEET_ID: 'synthetic_workbook_0000000000',
    SUPABASE_READ_MODEL_URL: 'https://synthetic.supabase.co', SUPABASE_READ_MODEL_SERVICE_KEY: 'synthetic-service-key-197', SUPABASE_READ_MODEL_SOURCE_KEY: 'synthetic_source' };
  for (const [name,value] of Object.entries(env)) vi.stubEnv(name,value);
  resetEnvCache(); resetServices(); session.sub=null;
  fetchBoundary = vi.fn(async () => new Response(JSON.stringify({status:'in_progress'})));
  vi.stubGlobal('fetch',fetchBoundary);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); resetEnvCache(); resetServices(); });
const request = (headers: Record<string,string> = {}) => new Request('https://synthetic.example/api/ops/sheet-mirror',{method:'POST',headers:{origin:'https://synthetic.example',...headers}});
it('owner route enforces session, owner role, same-origin and UUID before any provider work', async () => {
  expect((await POST(request())).status).toBe(401);
  session.sub=viewer; expect((await POST(request())).status).toBe(403);
  session.sub=owner; expect((await POST(request({origin:'https://cross-origin.example'}))).status).toBe(403);
  expect((await POST(request())).status).toBe(400);
  expect((await POST(request({'Idempotency-Key':'invalid'}))).status).toBe(400);
  expect(fetchBoundary).not.toHaveBeenCalled();
  const result = await POST(request({'Idempotency-Key':'11111111-1111-4111-8111-111111111111'}));
  expect(result.status).toBe(200); expect(await result.json()).toMatchObject({status:'in_progress'});
  expect(result.headers.get('cache-control')).toContain('no-store');
});
it('scheduled route rejects bad/missing bearer before providers; correct bearer enters the live typed importer', async () => {
  for (const authorization of ['', 'Bearer incorrect', `bearer ${cron}`, `Bearer ${cron}x`]) expect((await GET(request({authorization}))).status).toBe(403);
  expect(fetchBoundary).not.toHaveBeenCalled();
  expect((await GET(request({authorization:`Bearer ${cron}`}))).status).toBe(200);
  expect(String(fetchBoundary.mock.calls[0]?.[0])).toContain('content_studio_shadow_claim');
});
