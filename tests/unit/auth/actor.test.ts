import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT, decodeJwt } from 'jose';
import { AppError } from '@/domain/errors';
import { resetEnvCache } from '@/lib/env';

/**
 * CS-005 server boundary: requireActor role matrix, same-origin enforcement,
 * and the signed test cookie (mode gating, forgery, tampering, expiry).
 * SEC-05, SEC-06.
 */
const mocks = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  auth: vi.fn<() => Promise<unknown>>(),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (mocks.jar.has(name) ? { name, value: mocks.jar.get(name) } : undefined),
  }),
}));

vi.mock('@/lib/auth/config', () => ({ auth: mocks.auth }));

const { getActor, requireActor, assertSameOrigin, requireMutation } = await import('@/lib/auth');
const { SYNTHETIC_SUBJECTS } = await import('@/lib/auth/policy');
const { TEST_COOKIE_NAME, signTestCookie, verifyTestCookie } = await import('@/lib/auth/test-cookie');

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

const E2E = { CS_DATA_MODE: 'fake', CS_TEST_MODE: 'e2e', AUTH_SECRET: SECRET, VERCEL_ENV: undefined } as const;

async function signInAs(who: keyof typeof SYNTHETIC_SUBJECTS) {
  mocks.jar.set(TEST_COOKIE_NAME, await signTestCookie(SYNTHETIC_SUBJECTS[who]));
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof AppError ? e.code : `non-app-error:${String(e)}`;
  }
}

beforeEach(() => {
  mocks.jar.clear();
  mocks.auth.mockReset();
  mocks.auth.mockResolvedValue(null);
  setEnv({
    ...E2E,
    CS_OWNER_GOOGLE_SUB: undefined,
    CS_VIEWER_GOOGLE_SUBS: undefined,
    CS_OWNER_EMAIL: undefined,
    AUTH_GOOGLE_ID: undefined,
    AUTH_GOOGLE_SECRET: undefined,
    APP_BASE_URL: 'http://localhost:3000',
  });
});

afterEach(() => {
  process.env = { ...saved };
  resetEnvCache();
});

describe('requireActor role matrix', () => {
  const cases: Array<[string, keyof typeof SYNTHETIC_SUBJECTS | null, string, string]> = [
    ['anonymous', null, 'AUTH_REQUIRED', 'AUTH_REQUIRED'],
    ['stranger', 'stranger', 'FORBIDDEN', 'FORBIDDEN'],
    ['viewer', 'viewer', 'ok', 'FORBIDDEN'],
    ['owner', 'owner', 'ok', 'ok'],
  ];
  for (const [label, who, viewerResult, ownerResult] of cases) {
    it(`${label}: viewer -> ${viewerResult}, owner -> ${ownerResult}`, async () => {
      if (who) await signInAs(who);
      expect(await codeOf(requireActor('viewer'))).toBe(viewerResult);
      expect(await codeOf(requireActor('owner'))).toBe(ownerResult);
    });
  }

  it('getActor returns sub and role for a role holder and null otherwise', async () => {
    expect(await getActor()).toBeNull();
    await signInAs('stranger');
    expect(await getActor()).toBeNull();
    await signInAs('viewer');
    expect(await getActor()).toEqual({ sub: SYNTHETIC_SUBJECTS.viewer, role: 'viewer' });
    await signInAs('owner');
    expect(await getActor()).toEqual({ sub: SYNTHETIC_SUBJECTS.owner, role: 'owner' });
  });

  it('role comes from current configuration, so a revoked subject loses access (SEC-06)', async () => {
    await signInAs('owner');
    expect(await codeOf(requireActor('owner'))).toBe('ok');
    setEnv({ CS_OWNER_GOOGLE_SUB: '200000000000000000009' });
    expect(await codeOf(requireActor('viewer'))).toBe('FORBIDDEN');
  });
});

describe('Google session path', () => {
  const OWNER = '200000000000000000001';
  beforeEach(() => {
    setEnv({
      CS_DATA_MODE: 'live',
      CS_TEST_MODE: undefined,
      AUTH_GOOGLE_ID: 'unit-google-client-id',
      AUTH_GOOGLE_SECRET: 'unit-google-client-secret',
      CS_OWNER_GOOGLE_SUB: OWNER,
    });
  });

  it('resolves the owner from the Auth.js session subject', async () => {
    mocks.auth.mockResolvedValue({ expires: 'x', user: { id: OWNER } });
    expect(await getActor()).toEqual({ sub: OWNER, role: 'owner' });
  });

  it('a session for an unconfigured subject is FORBIDDEN, not a role', async () => {
    mocks.auth.mockResolvedValue({ expires: 'x', user: { id: '200000000000000000003' } });
    expect(await codeOf(requireActor('viewer'))).toBe('FORBIDDEN');
  });

  it('fails closed when the session cannot be read', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.auth.mockRejectedValue(new Error('JWTSessionError'));
    expect(await codeOf(requireActor('viewer'))).toBe('AUTH_REQUIRED');
    spy.mockRestore();
  });

  it('is not consulted when Google sign-in is not configured', async () => {
    setEnv({ AUTH_GOOGLE_ID: undefined });
    mocks.auth.mockResolvedValue({ expires: 'x', user: { id: OWNER } });
    expect(await getActor()).toBeNull();
    expect(mocks.auth).not.toHaveBeenCalled();
  });
});

describe('test cookie', () => {
  it('is ignored outside fake + e2e mode', async () => {
    await signInAs('owner');
    setEnv({ CS_TEST_MODE: undefined });
    expect(await getActor()).toBeNull();
    setEnv({ CS_TEST_MODE: 'ci' });
    expect(await getActor()).toBeNull();
    setEnv({ CS_TEST_MODE: 'e2e', CS_DATA_MODE: 'live' });
    expect(await getActor()).toBeNull();
  });

  it('verification itself refuses outside the mode, independent of getActor', async () => {
    const value = await signTestCookie(SYNTHETIC_SUBJECTS.owner);
    expect(await verifyTestCookie(value)).toBe(SYNTHETIC_SUBJECTS.owner);
    setEnv({ CS_DATA_MODE: 'live' });
    expect(await verifyTestCookie(value)).toBeNull();
  });

  it('is ignored in a production deployment even with fake + e2e set', async () => {
    await signInAs('owner');
    // serverEnv() refuses fake mode in production outright, so nothing is served at all.
    setEnv({ VERCEL_ENV: 'production' });
    await expect(getActor()).rejects.toThrow(/refused in production/);
  });

  it('rejects a cookie signed with the wrong key', async () => {
    const now = Math.floor(Date.now() / 1000);
    const forged = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(SYNTHETIC_SUBJECTS.owner)
      .setIssuer('content-studio/test-auth')
      .setAudience('content-studio')
      .setIssuedAt(now)
      .setExpirationTime(now + 600)
      .sign(new TextEncoder().encode('attacker-chosen-key-that-is-long-enough-000'));
    mocks.jar.set(TEST_COOKIE_NAME, forged);
    expect(await getActor()).toBeNull();
    expect(await codeOf(requireActor('viewer'))).toBe('AUTH_REQUIRED');
  });

  it('rejects a tampered subject (viewer rewritten to owner)', async () => {
    const valid = await signTestCookie(SYNTHETIC_SUBJECTS.viewer);
    const [header, , signature] = valid.split('.');
    const payload = { ...decodeJwt(valid), sub: SYNTHETIC_SUBJECTS.owner, role: 'owner' };
    const tampered = [header, Buffer.from(JSON.stringify(payload)).toString('base64url'), signature].join('.');
    mocks.jar.set(TEST_COOKIE_NAME, tampered);
    expect(await getActor()).toBeNull();
  });

  it('rejects an unsigned (alg none) cookie', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(
      JSON.stringify({ sub: SYNTHETIC_SUBJECTS.owner, iss: 'content-studio/test-auth', aud: 'content-studio', exp: 9999999999 }),
    ).toString('base64url');
    mocks.jar.set(TEST_COOKIE_NAME, `${header}.${body}.`);
    expect(await getActor()).toBeNull();
  });

  it('rejects an expired cookie', async () => {
    mocks.jar.set(TEST_COOKIE_NAME, await signTestCookie(SYNTHETIC_SUBJECTS.owner, -60));
    expect(await getActor()).toBeNull();
    expect(await codeOf(requireActor('viewer'))).toBe('AUTH_REQUIRED');
  });

  it('rejects garbage and an empty value', async () => {
    expect(await verifyTestCookie('not-a-token')).toBeNull();
    expect(await verifyTestCookie('')).toBeNull();
    expect(await verifyTestCookie(undefined)).toBeNull();
  });
});

describe('assertSameOrigin', () => {
  const url = 'http://localhost:3000/api/items';
  const req = (headers: Record<string, string>) => new Request(url, { method: 'POST', headers });
  const reason = (fn: () => void) => {
    try {
      fn();
      return 'ok';
    } catch (e) {
      return e instanceof AppError ? `${e.code}:${String(e.details.reason)}` : 'non-app-error';
    }
  };

  it('accepts the app origin', () => {
    expect(reason(() => assertSameOrigin(req({ origin: 'http://localhost:3000' })))).toBe('ok');
  });

  it('accepts a missing Origin only with Sec-Fetch-Site: same-origin', () => {
    expect(reason(() => assertSameOrigin(req({ 'sec-fetch-site': 'same-origin' })))).toBe('ok');
    expect(reason(() => assertSameOrigin(req({ 'sec-fetch-site': 'cross-site' })))).toBe('FORBIDDEN:cross_origin');
    expect(reason(() => assertSameOrigin(req({ 'sec-fetch-site': 'same-site' })))).toBe('FORBIDDEN:cross_origin');
    expect(reason(() => assertSameOrigin(req({})))).toBe('FORBIDDEN:cross_origin');
  });

  it('refuses a foreign, look-alike or null origin', () => {
    for (const origin of ['https://evil.example.com', 'http://localhost:3001', 'https://localhost:3000', 'http://localhost:3000.evil.example.com', 'null']) {
      expect(reason(() => assertSameOrigin(req({ origin, 'sec-fetch-site': 'same-origin' })))).toBe('FORBIDDEN:cross_origin');
    }
  });

  it('uses the request origin when APP_BASE_URL is unset', () => {
    setEnv({ APP_BASE_URL: undefined });
    expect(reason(() => assertSameOrigin(new Request('http://127.0.0.1:3200/x', { method: 'POST', headers: { origin: 'http://127.0.0.1:3200' } })))).toBe('ok');
    expect(reason(() => assertSameOrigin(new Request('http://127.0.0.1:3200/x', { method: 'POST', headers: { origin: 'http://localhost:3000' } })))).toBe('FORBIDDEN:cross_origin');
  });

  it('requireMutation checks origin before the session and needs an owner', async () => {
    await signInAs('owner');
    expect(await codeOf(requireMutation(req({ origin: 'https://evil.example.com' })))).toBe('FORBIDDEN');
    expect(await codeOf(requireMutation(req({ origin: 'http://localhost:3000' })))).toBe('ok');
    await signInAs('viewer');
    expect(await codeOf(requireMutation(req({ origin: 'http://localhost:3000' })))).toBe('FORBIDDEN');
    mocks.jar.clear();
    expect(await codeOf(requireMutation(req({ origin: 'http://localhost:3000' })))).toBe('AUTH_REQUIRED');
  });
});
