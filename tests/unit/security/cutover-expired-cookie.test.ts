import { afterEach, expect, it, vi } from 'vitest';
import { decode, encode } from 'next-auth/jwt';
import { formatWithOptions } from 'node:util';

const mock = vi.hoisted(() => ({ headers: new Headers(), services: vi.fn(), status: vi.fn(), execute: vi.fn() }));
// Only Next's request context and provider ports are faked. Auth.js, its shared
// config, JWT decryption/expiry, requireMutation and the route all run for real.
vi.mock('next/headers', () => ({ headers: async () => mock.headers,
  cookies: () => { throw new Error('Synthetic test-cookie auth must not run'); } }));
vi.mock('@/application/container', () => ({ getServices: mock.services }));
vi.mock('@/application/cutover-status', () => ({ readOwnerCutoverStatus: mock.status }));
import { GET, POST } from '@/app/api/ops/content-cutover/route';
import { resetEnvCache } from '@/lib/env';
import { requireMutation } from '@/lib/auth';

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); resetEnvCache(); vi.restoreAllMocks(); vi.clearAllMocks(); });

it.each([false, true])('expired real encrypted owner cookie fails closed without private logs (secure=%s)', async secure => {
  const origin = `${secure ? 'https' : 'http'}://synthetic.example`;
  const secret = 'synthetic-expired-cookie-secret-000000000000';
  const sub = '100000000000000000001', email = 'synthetic-owner@example.com';
  const cookieName = `${secure ? '__Secure-' : ''}authjs.session-token`;
  for (const [key, value] of Object.entries({
    CS_DATA_MODE: 'live', CS_CONTENT_STORE: 'sheet', CS_TEST_MODE: 'unit', VERCEL_ENV: '',
    AUTH_SECRET: secret, AUTH_GOOGLE_ID: 'synthetic-client', AUTH_GOOGLE_SECRET: 'synthetic-google-secret',
    AUTH_URL: origin, APP_BASE_URL: origin, CS_OWNER_GOOGLE_SUB: sub,
  })) vi.stubEnv(key, value);
  resetEnvCache();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-26T00:00:00Z'));
  const token = await encode({ secret, salt: cookieName, maxAge: 1, token: { sub, email, role: 'owner' } });
  expect(token.split('.')).toHaveLength(5); // Real JWE, not a signed synthetic test cookie.
  const payload = await decode({ secret, salt: cookieName, token });
  expect(payload).toMatchObject({ sub, email });
  expect(payload?.jti).toEqual(expect.any(String));
  const request = (method: 'GET' | 'POST') => {
    mock.headers = new Headers({ host: 'synthetic.example', 'x-forwarded-proto': secure ? 'https' : 'http',
      origin, cookie: `${cookieName}=${token}`, ...(method === 'POST' ? {
        'Content-Type': 'application/json', 'Idempotency-Key': '11111111-1111-4111-8111-111111111111',
      } : {}) });
    return new Request(`${origin}/api/ops/content-cutover`, { method, headers: mock.headers,
      ...(method === 'POST' ? { body: JSON.stringify({ action: 'backup' }) } : {}) });
  };
  mock.services.mockReturnValue({ liveCutover: { execute: mock.execute } });
  mock.execute.mockResolvedValue({ status: 'verified', manifestHash: 'a'.repeat(64) });
  mock.status.mockResolvedValue({ synthetic: true });
  // Positive control proves this exact cookie reaches the actual owner branch.
  await requireMutation(request('GET'));
  expect((await GET(request('GET'))).status).toBe(200);
  expect((await POST(request('POST'))).status).toBe(200);
  expect(mock.execute).toHaveBeenCalledWith('backup', expect.any(String), expect.any(String), 'owner_session');
  vi.clearAllMocks();
  vi.setSystemTime(new Date('2026-10-26T00:01:00Z')); // Beyond Auth.js's 15-second clock tolerance.
  await expect(decode({ secret, salt: cookieName, token })).rejects.toMatchObject({ code: 'ERR_JWT_EXPIRED' });

  const consoleOutput: string[] = [], stdout: string[] = [], stderr: string[] = [];
  const spies = [
    ...(['error', 'warn', 'debug', 'log', 'info', 'trace'] as const).map(level => vi.spyOn(console, level)
      .mockImplementation((...args) => { consoleOutput.push(formatWithOptions({ depth: null }, ...args)); })),
    vi.spyOn(process.stdout, 'write').mockImplementation(chunk => { stdout.push(String(chunk)); return true; }),
    vi.spyOn(process.stderr, 'write').mockImplementation(chunk => { stderr.push(String(chunk)); return true; }),
  ];
  const responses: Response[] = [];
  try {
    responses.push(await GET(request('GET')), await POST(request('POST')));
  } finally { for (const spy of spies) spy.mockRestore(); }
  expect(responses.map(response => response.status)).toEqual([401, 401]);
  for (const response of responses) expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
  // This exact assertion also prevents a false green if auth/config is mocked,
  // the cookie is not consumed, or decryption fails for an unrelated reason.
  expect(consoleOutput).toEqual(['AUTH_ERROR', 'AUTH_ERROR']);
  const output = [...consoleOutput, ...stdout, ...stderr, ...await Promise.all(responses.map(response => response.text()))].join('\n');
  for (const privateText of [sub, email, payload!.jti!, token, secret, 'synthetic-google-secret',
    'payload', 'sub', 'jti', 'email', 'token']) expect(output).not.toContain(privateText);
  expect(mock.services).not.toHaveBeenCalled();
  expect(mock.status).not.toHaveBeenCalled();
  expect(mock.execute).not.toHaveBeenCalled();
});
