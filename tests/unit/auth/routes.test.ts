import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEnvCache } from '@/lib/env';

/**
 * CS-005 route handlers: /api/test-auth exists only in fake + e2e mode, and
 * /api/me reveals a role only (never the subject), always no-store. SEC-05, SEC-07.
 */
const mocks = vi.hoisted(() => ({ jar: new Map<string, string>() }));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (mocks.jar.has(name) ? { name, value: mocks.jar.get(name) } : undefined),
  }),
}));
vi.mock('@/lib/auth/config', () => ({ auth: async () => null }));

const testAuth = await import('@/app/api/test-auth/route');
const me = await import('@/app/api/me/route');
const { TEST_COOKIE_NAME } = await import('@/lib/auth/test-cookie');
const { SYNTHETIC_SUBJECTS } = await import('@/lib/auth/policy');

const SECRET = 'unit-only-auth-secret-not-a-real-value-0000000';
const saved = { ...process.env };

function setEnv(values: Record<string, string | undefined>) {
  const env = process.env as Record<string, string | undefined>;
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  resetEnvCache();
}

function post(body: unknown) {
  return new Request('http://localhost:3000/api/test-auth', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Sign in through the route and copy the Set-Cookie value into the mocked jar. */
async function signInVia(as: string) {
  const res = await testAuth.POST(post({ as }));
  const value = res.cookies.get(TEST_COOKIE_NAME)?.value ?? '';
  if (value) mocks.jar.set(TEST_COOKIE_NAME, value);
  else mocks.jar.delete(TEST_COOKIE_NAME);
  return res;
}

beforeEach(() => {
  mocks.jar.clear();
  setEnv({
    CS_DATA_MODE: 'fake',
    CS_TEST_MODE: 'e2e',
    AUTH_SECRET: SECRET,
    VERCEL_ENV: undefined,
    CS_OWNER_GOOGLE_SUB: undefined,
    CS_VIEWER_GOOGLE_SUBS: undefined,
    AUTH_GOOGLE_ID: undefined,
  });
});

afterEach(() => {
  process.env = { ...saved };
  resetEnvCache();
});

describe('/api/test-auth', () => {
  it('is 404 outside fake + e2e mode', async () => {
    for (const env of [{ CS_TEST_MODE: undefined }, { CS_TEST_MODE: 'ci' }, { CS_TEST_MODE: 'e2e', CS_DATA_MODE: 'live' }]) {
      setEnv(env);
      const res = await testAuth.POST(post({ as: 'owner' }));
      expect(res.status).toBe(404);
      expect(res.headers.get('set-cookie')).toBeNull();
      setEnv({ CS_DATA_MODE: 'fake', CS_TEST_MODE: 'e2e' });
    }
  });

  it('sets an httpOnly lax cookie and rejects an unknown identity', async () => {
    const res = await testAuth.POST(post({ as: 'owner' }));
    expect(res.status).toBe(200);
    const header = res.headers.get('set-cookie') ?? '';
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/SameSite=lax/i);
    expect(header).not.toContain(SECRET);
    expect((await testAuth.POST(post({ as: 'admin' }))).status).toBe(400);
  });
});

describe('/api/me', () => {
  it('anonymous is 401 JSON with no-store', async () => {
    const res = await me.GET();
    expect(res.status).toBe(401);
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(((await res.json()) as { code: string }).code).toBe('AUTH_REQUIRED');
  });

  it('stranger is 403; viewer and owner get their role and nothing else', async () => {
    await signInVia('stranger');
    expect((await me.GET()).status).toBe(403);

    await signInVia('viewer');
    let res = await me.GET();
    let text = await res.text();
    expect(JSON.parse(text)).toEqual({ ok: true, role: 'viewer' });
    expect(text).not.toContain(SYNTHETIC_SUBJECTS.viewer);

    await signInVia('owner');
    res = await me.GET();
    text = await res.text();
    expect(JSON.parse(text)).toEqual({ ok: true, role: 'owner' });
    expect(text).not.toContain(SYNTHETIC_SUBJECTS.owner);
    expect(res.headers.get('cache-control')).toContain('no-store');

    await signInVia('none');
    expect((await me.GET()).status).toBe(401);
  });
});
