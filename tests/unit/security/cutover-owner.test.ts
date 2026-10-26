import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ sub: '100000000000000000001' as string | null, broken: false,
  execute: vi.fn(), services: vi.fn(), status: vi.fn(), age: vi.fn() }));
vi.mock('@/lib/auth/config', () => ({ auth: async () => {
  if (mock.broken) throw new Error('SYNTHETIC_PRIVATE_SESSION');
  return mock.sub ? { user: { id: mock.sub } } : null;
} }));
vi.mock('@/application/container', () => ({ getServices: mock.services }));
vi.mock('@/application/cutover-status', () => ({ readCutoverStatus: mock.status,
  readOwnerCutoverStatus: async () => ({ ...await mock.status(), lastImportAgeMs: await mock.age() }) }));
import { GET, POST } from '@/app/api/ops/content-cutover/route';
import { GET as cronExport } from '@/app/api/ops/content-export/reconcile/route';
import { GET as cronBackup } from '@/app/api/ops/content-backup/reconcile/route';
import { requireMutation } from '@/lib/auth';
import { resetEnvCache } from '@/lib/env';
import { setTelemetrySink } from '@/observability/events';

const build = 'a'.repeat(40), key = '11111111-1111-4111-8111-111111111111';
const env = { CS_DATA_MODE: 'live', CS_CONTENT_STORE: 'db-read', CS_CONTENT_READ_ENABLED: 'true', CS_CONTENT_DB_ENABLED: 'true', CS_CONTENT_WRITE_ENABLED: 'false',
  AUTH_SECRET: 'synthetic-owner-auth-secret-0000000000', AUTH_GOOGLE_ID: 'synthetic-client', AUTH_GOOGLE_SECRET: 'synthetic-google-secret',
  CS_OWNER_GOOGLE_SUB: '100000000000000000001', CS_VIEWER_GOOGLE_SUBS: '100000000000000000002', CS_COMMIT_SHA: build, VERCEL_GIT_COMMIT_SHA: '',
  APP_BASE_URL: 'https://synthetic.example', CRON_SECRET: 'synthetic-cron-bearer',
  SUPABASE_READ_MODEL_URL: 'https://synthetic.supabase.co', SUPABASE_READ_MODEL_SERVICE_KEY: 'synthetic-service-key', SUPABASE_READ_MODEL_SOURCE_KEY: 'synthetic_source' };
const req = (method: 'GET' | 'POST', headers: Record<string, string> = { origin: env.APP_BASE_URL }, body: unknown = { action: 'activate-db', expectedBuild: build }) =>
  new Request(`${env.APP_BASE_URL}/api/ops/content-cutover`, { method, headers: { ...headers, ...(method === 'POST' ? { 'Idempotency-Key': key } : {}) }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) });
const sink = vi.fn();
beforeEach(() => {
  vi.clearAllMocks(); mock.sub = env.CS_OWNER_GOOGLE_SUB; mock.broken = false;
  for (const [k,v] of Object.entries(env)) vi.stubEnv(k,v);
  resetEnvCache(); setTelemetrySink(sink);
  mock.services.mockReturnValue({ liveCutover: { execute: mock.execute } });
  mock.execute.mockResolvedValue({ mode: 'db', build, contract: 'schema-2:cutover-1' });
  mock.status.mockResolvedValue({ build, gates: {} }); mock.age.mockResolvedValue(1234);
});
afterEach(() => { vi.unstubAllEnvs(); resetEnvCache(); setTelemetrySink(null); vi.restoreAllMocks(); });

it.each(['GET', 'POST'] as const)('owner %s uses real requireMutation during freeze without consulting red authority gates', async method => {
  const response = await (method === 'GET' ? GET : POST)(req(method));
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
  if (method === 'POST') {
    expect(mock.execute).toHaveBeenCalledExactlyOnceWith('activate-db', key, build, 'owner_session');
    expect(sink).toHaveBeenCalledWith(expect.objectContaining({ facts: { actor: 'owner_session', action: 'activate-db' } }));
  } else expect((await response.json()).status.lastImportAgeMs).toBe(1234);
});
it.each(['GET', 'POST'] as const)('owner %s needs no cron secret', async method => {
  vi.stubEnv('CRON_SECRET',''); resetEnvCache();
  expect((await (method === 'GET' ? GET : POST)(req(method))).status).toBe(200);
});
it.each(['GET', 'POST'] as const)('valid bearer %s has identical public bytes, ignores cookie/origin, and records cron actor', async method => {
  mock.sub = null;
  const response = await (method === 'GET' ? GET : POST)(req(method, { authorization: `Bearer ${env.CRON_SECRET}`, origin: 'https://cross.example' }));
  expect(response.status).toBe(200);
  expect(await response.text()).toBe(JSON.stringify(method === 'GET' ? { ok: true, status: { build, gates: {} } }
    : { ok: true, result: { mode: 'db', build, contract: 'schema-2:cutover-1' } }));
  expect(mock.age).not.toHaveBeenCalled();
  if (method === 'POST') expect(mock.execute).toHaveBeenCalledExactlyOnceWith('activate-db', key, build, 'cron_bearer');
});
it.each(['', 'Bearer wrong', 'bearer synthetic-cron-bearer', 'Bearer synthetic-cron-bearer-extra'])('bad bearer never falls back to an owner cookie (%s)', async authorization => {
  for (const method of ['GET', 'POST'] as const) {
    const r = await (method === 'GET' ? GET : POST)(req(method, { origin: env.APP_BASE_URL, authorization }));
    expect(r.status).toBe(403); expect(await r.json()).toMatchObject({ details: { reason: 'cron_auth' } });
  }
  expect(mock.services).not.toHaveBeenCalled(); expect(mock.status).not.toHaveBeenCalled();
});
it.each([null, '100000000000000000002', '100000000000000000003', 'different-owner'])('refuses anonymous/viewer/stranger/unbound owner %s on both methods', async sub => {
  mock.sub = sub;
  for (const method of ['GET', 'POST'] as const) {
    const response = await (method === 'GET' ? GET : POST)(req(method));
    expect(response.status).toBe(sub ? 403 : 401); expect(response.headers.get('cache-control')).toContain('private, no-store');
  }
  expect(mock.services).not.toHaveBeenCalled(); expect(mock.status).not.toHaveBeenCalled();
});
it.each<Record<string, string>>([{}, { origin: 'null' }, { origin: 'https://cross.example' }, { 'sec-fetch-site': 'cross-site' },
  { origin: 'https://cross.example', 'sec-fetch-site': 'same-origin' }])('refuses missing or cross-origin CSRF proof %j on both methods', async headers => {
  for (const method of ['GET', 'POST'] as const) expect((await (method === 'GET' ? GET : POST)(req(method, headers))).status).toBe(403);
  expect(mock.services).not.toHaveBeenCalled(); expect(mock.status).not.toHaveBeenCalled();
});
it('accepts same-origin fetch metadata only when Origin is absent; configured origin prevents host spoofing', async () => {
  expect((await GET(req('GET', { 'sec-fetch-site': 'same-origin' }))).status).toBe(200);
  expect((await POST(req('POST', { 'sec-fetch-site': 'same-origin' }))).status).toBe(200);
  const spoof = new Request('https://cross.example/api/ops/content-cutover', { headers: { origin: 'https://cross.example' } });
  expect((await GET(spoof)).status).toBe(403);
});
it('unreadable sessions fail closed without logging session error text', async () => {
  mock.broken = true; const log = vi.spyOn(console,'error').mockImplementation(() => {});
  const response = await POST(req('POST')); expect(response.status).toBe(401);
  expect(JSON.stringify(log.mock.calls)).not.toContain('SYNTHETIC_PRIVATE_SESSION'); expect(mock.execute).not.toHaveBeenCalled();
});
it.each(['measure', 'backup', 'rollback', 'export', 'activate-read', 'activate-db'])('owner %s has exactly the bearer validation, build binding, key and replay path', async action => {
  const parity = { exact: true, dbHash:'b'.repeat(64), sheetHash:'b'.repeat(64), counts: {library:0,queue:0,schedule:0,workflow_settings:0}, differences:[] };
  mock.execute.mockResolvedValue(action === 'measure' ? { coverage:'all-rows', build,
    samples: Object.fromEntries(['library','queue','ready','schedule','queue_summary','workflow_settings'].map(collection => [collection, {collection, idsEqual:true,blocking:0,fields:1,equal:1,lagMs:0}])) }
    : action === 'backup' ? {status:'verified',manifestHash:'b'.repeat(64)} : action === 'rollback' ? {readyToFlip:'sheet',writesDisabled:true,build,parity}
    : action === 'export' ? parity : {mode:action === 'activate-read' ? 'db-read' : 'db',build,contract:'schema-2:cutover-1'});
  const body = { action, ...(action.startsWith('activate-') ? { expectedBuild: build } : {}) };
  const owner = await POST(req('POST', undefined, body));
  const bearer = await POST(req('POST', { authorization: `Bearer ${env.CRON_SECRET}` }, body));
  expect(owner.status).toBe(200); expect(await owner.text()).toBe(await bearer.text());
  expect(mock.execute.mock.calls.map(c => c.slice(0,3))).toEqual([[action,key,build],[action,key,build]]);
  const missingKey = req('POST', undefined, body); missingKey.headers.delete('Idempotency-Key');
  expect((await POST(missingKey)).status).toBe(400);
  expect((await POST(req('POST', undefined, { ...body, extra: true }))).status).toBe(action.startsWith('activate-') ? 422 : 400);
});
it.each(['activate-read','activate-db'])('owner %s refuses missing or changed expectedBuild before claims and audit', async action => {
  for (const expectedBuild of [undefined, '', build.toUpperCase(), build.slice(0,39), build + ' ', 'b'.repeat(40)]) {
    expect((await POST(req('POST', undefined, { action, expectedBuild }))).status).toBe(expectedBuild === 'b'.repeat(40) ? 409 : 422);
  }
  expect(mock.services).not.toHaveBeenCalled(); expect(mock.execute).not.toHaveBeenCalled(); expect(sink).not.toHaveBeenCalled();
});
it('exempts only the exact cutover maintenance path; ordinary/lookalike mutations stay frozen', async () => {
  for (const path of ['/api/ops/content-cutover/other','/api/library/SYN-L001/draft']) {
    await expect(requireMutation(new Request(env.APP_BASE_URL + path, { headers: { origin: env.APP_BASE_URL } })))
      .rejects.toMatchObject({ code: 'FORBIDDEN', details: { reason: 'rollback_read_only' } });
  }
});
it('cron export/backup remain bearer-only with an owner session and same origin', async () => {
  expect((await cronExport(req('GET'))).status).toBe(403); expect((await cronBackup(req('GET'))).status).toBe(403);
  expect(mock.services).not.toHaveBeenCalled();
});
it('no owner subject, cookie, credentials or provider content appears in success/error response or telemetry', async () => {
  const body = await (await POST(req('POST'))).text();
  mock.execute.mockRejectedValueOnce(new Error('SYNTHETIC_PRIVATE_COPY ' + env.CRON_SECRET));
  const error = await POST(req('POST')); expect(error.status).toBe(500);
  const output = body + await error.text() + JSON.stringify(sink.mock.calls);
  for (const privateValue of [env.CRON_SECRET, env.AUTH_GOOGLE_SECRET, env.CS_OWNER_GOOGLE_SUB, 'SYNTHETIC_PRIVATE_COPY']) expect(output).not.toContain(privateValue);
});
