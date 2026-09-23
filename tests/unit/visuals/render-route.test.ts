import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEnvCache } from '@/lib/env';

/**
 * CS-012 preview route: server re-render only, sandboxed no-script headers,
 * viewer or owner session required (VIS-03, SEC-09).
 */
const mocks = vi.hoisted(() => ({ jar: new Map<string, string>() }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => (mocks.jar.has(name) ? { name, value: mocks.jar.get(name) } : undefined) }),
}));
vi.mock('@/lib/auth/config', () => ({ auth: async () => null }));

const testAuth = await import('@/app/api/test-auth/route');
const renderRoute = await import('@/app/api/library/[libraryId]/render/route');
const visualRoute = await import('@/app/api/library/[libraryId]/visual/route');
const { TEST_COOKIE_NAME } = await import('@/lib/auth/test-cookie');
const { resetServices } = await import('@/application/container');

const saved = { ...process.env };

async function signIn(as: 'owner' | 'viewer' | 'none') {
  const res = await testAuth.POST(new Request('http://localhost:3000/api/test-auth', { method: 'POST', body: JSON.stringify({ as }) }));
  const value = res.cookies.get(TEST_COOKIE_NAME)?.value ?? '';
  if (value) mocks.jar.set(TEST_COOKIE_NAME, value);
  else mocks.jar.delete(TEST_COOKIE_NAME);
}

const get = (id: string, rev = 'current') =>
  renderRoute.GET(new Request(`http://localhost:3000/api/library/${id}/render?rev=${rev}`), { params: Promise.resolve({ libraryId: id }) });

beforeEach(() => {
  mocks.jar.clear();
  Object.assign(process.env, { CS_DATA_MODE: 'fake', CS_TEST_MODE: 'e2e', AUTH_SECRET: 'unit-only-auth-secret-not-a-real-value-0000000', APP_BASE_URL: 'http://localhost:3000' });
  delete (process.env as Record<string, string | undefined>).VERCEL_ENV;
  resetEnvCache();
  resetServices();
});

afterEach(() => {
  process.env = { ...saved };
  resetEnvCache();
  resetServices();
});

describe('GET /api/library/[id]/render', () => {
  it('requires a session', async () => {
    expect((await get('SYN-L012')).status).toBe(401);
  });

  it('serves a sandboxed, no-store SVG re-render for a viewer', async () => {
    await signIn('viewer');
    const res = await get('SYN-L012');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/svg+xml; charset=utf-8');
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(res.headers.get('x-visual-version')).toBe('SOAR-v1.1 / r02 / LinkedIn / en');
    const body = await res.text();
    expect(body.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(body).not.toMatch(/<script|drive\.google\.com|SYNTH_asset/);
    expect(await (await get('SYN-L012')).text()).toBe(body);
  });

  it('refuses unknown rev values, text-only rows and incomplete briefs', async () => {
    await signIn('viewer');
    expect((await get('SYN-L012', 'r01')).status).toBe(400);
    expect((await get('SYN-L001')).status).toBe(404);
    expect((await get('SYN-L007')).status).toBe(422);
  });
});

describe('POST /api/library/[id]/visual', () => {
  const post = (id: string, body: unknown, origin = 'http://localhost:3000') =>
    visualRoute.POST(new Request(`http://localhost:3000/api/library/${id}/visual`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) }), {
      params: Promise.resolve({ libraryId: id }),
    });

  it('refuses viewers, cross-origin calls and a body for a different row', async () => {
    await signIn('viewer');
    expect((await post('SYN-L001', { action: 'check_screenshot', libraryId: 'SYN-L001', screenshotId: 'SHOT-2026-014' })).status).toBe(403);
    await signIn('owner');
    expect((await post('SYN-L001', { action: 'check_screenshot', libraryId: 'SYN-L001', screenshotId: 'SHOT-2026-014' }, 'https://evil.example.com')).status).toBe(403);
    expect((await post('SYN-L001', { action: 'check_screenshot', libraryId: 'SYN-L009', screenshotId: 'SHOT-2026-014' })).status).toBe(400);
    const res = await post('SYN-L001', { action: 'check_screenshot', libraryId: 'SYN-L001', screenshotId: 'SHOT-2026-014' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { reuse: { state: string } }).reuse.state).toBe('same_platform');
  });
});
