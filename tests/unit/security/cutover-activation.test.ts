import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  env: { CRON_SECRET: 'synthetic-activation-bearer', VERCEL_GIT_COMMIT_SHA: '', CS_COMMIT_SHA: 'a'.repeat(40) },
  execute: vi.fn(), services: vi.fn(),
}));
vi.mock('@/lib/env', () => ({ serverEnv: () => mocks.env }));
vi.mock('@/application/container', () => ({ getServices: mocks.services }));
import { POST } from '@/app/api/ops/content-cutover/route';

const build = 'a'.repeat(40);
const request = (body: unknown, authorized = true) => new Request('https://synthetic.example/api/ops/content-cutover', {
  method: 'POST', headers: { Authorization: authorized ? `Bearer ${mocks.env.CRON_SECRET}` : 'Bearer wrong',
    'Idempotency-Key': '11111111-1111-4111-8111-111111111111' }, body: JSON.stringify(body),
});
beforeEach(() => {
  vi.clearAllMocks(); mocks.env.VERCEL_GIT_COMMIT_SHA = ''; mocks.env.CS_COMMIT_SHA = build;
  mocks.services.mockReturnValue({ liveCutover: { execute: mocks.execute } });
  mocks.execute.mockResolvedValue({ build });
});
afterEach(() => vi.restoreAllMocks());

it.each(['activate-read', 'activate-db'])('build binding: %s validates before any service access', async action => {
  for (const expectedBuild of [undefined, null, 1, '', 'synthetic-malformed', build.toUpperCase(), build.slice(0, 39), build + 'a', ' ' + build, build + '\n']) {
    const response = await POST(request({ action, expectedBuild }));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ ok: false, details: { reason: 'cutover_expected_build_invalid' } });
    expect(response.headers.get('cache-control')).toContain('private, no-store');
  }
  expect(mocks.services).not.toHaveBeenCalled(); expect(mocks.execute).not.toHaveBeenCalled();
});
it.each(['activate-read', 'activate-db'])('build binding: %s refuses full-length mismatch including a common prefix', async action => {
  const response = await POST(request({ action, expectedBuild: build.slice(0, 39) + 'b' }));
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ ok: false, details: { reason: 'cutover_build_mismatch' } });
  expect(mocks.services).not.toHaveBeenCalled(); expect(mocks.execute).not.toHaveBeenCalled();
});
it.each(['activate-read', 'activate-db'])('build binding: %s uses platform precedence and never normalizes the server build', async action => {
  for (const deployed of [build.slice(0, 39) + 'b', build.toUpperCase(), ' ' + build, build + '\n', build.slice(0, 39)]) {
    mocks.env.VERCEL_GIT_COMMIT_SHA = deployed;
    expect((await POST(request({ action, expectedBuild: build }))).status).toBe(409);
  }
  expect(mocks.services).not.toHaveBeenCalled();
});
it.each(['activate-read', 'activate-db'])('build binding: %s authenticates first and rejects extra body keys', async action => {
  expect((await POST(request({ action }, false))).status).toBe(403);
  expect((await POST(request({ action, expectedBuild: build, extra: true }))).status).toBe(422);
  expect(mocks.services).not.toHaveBeenCalled();
});
it.each(['activate-read', 'activate-db'])('build binding: %s forwards the single server snapshot, and refuses changed-build replay', async action => {
  // A second read would observe a new deployment: SQL must receive the first.
  let reads = 0;
  Object.defineProperty(mocks.env, 'VERCEL_GIT_COMMIT_SHA', { configurable: true, get: () => ++reads === 1 ? build : 'b'.repeat(40) });
  try {
    expect((await POST(request({ action, expectedBuild: build }))).status).toBe(200);
    expect(reads).toBe(1);
    expect(mocks.execute).toHaveBeenCalledExactlyOnceWith(action, '11111111-1111-4111-8111-111111111111', build, 'cron_bearer');
    // Same key, different expectation cannot reach a successful replay.
    expect((await POST(request({ action, expectedBuild: 'c'.repeat(40) }))).status).toBe(409);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  } finally { Object.defineProperty(mocks.env, 'VERCEL_GIT_COMMIT_SHA', { configurable: true, writable: true, value: '' }); }
});
it.each(['activate-read', 'activate-db'])('build binding: %s accepts fallback identity and platform identity only when exact', async action => {
  Object.defineProperty(mocks.env, 'VERCEL_GIT_COMMIT_SHA', { configurable: true, writable: true, value: undefined });
  expect((await POST(request({ action, expectedBuild: build }))).status).toBe(200);
  mocks.env.VERCEL_GIT_COMMIT_SHA = build;
  mocks.env.CS_COMMIT_SHA = 'b'.repeat(40);
  expect((await POST(request({ action, expectedBuild: build }))).status).toBe(200);
  expect(mocks.execute).toHaveBeenNthCalledWith(1, action, '11111111-1111-4111-8111-111111111111', build, 'cron_bearer');
  expect(mocks.execute).toHaveBeenNthCalledWith(2, action, '11111111-1111-4111-8111-111111111111', build, 'cron_bearer');
});
