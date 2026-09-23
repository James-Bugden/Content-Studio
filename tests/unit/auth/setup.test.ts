import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetEnvCache } from '@/lib/env';

/**
 * CS-019 first-run owner setup: only live mode with Google configured and no
 * owner yet; grants nothing; shows a subject only to itself (and only to the
 * configured email when one is set); switches off once an owner exists.
 */
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
  }),
}));

const { ownerSetupMode, setupAllowed, rememberSetupSubject, readSetupSubject } = await import('@/lib/auth/setup');
const { signInCallback } = await import('@/lib/auth/callbacks');

const saved = { ...process.env };
function setEnv(values: Record<string, string | undefined>) {
  const env = process.env as Record<string, string | undefined>;
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  resetEnvCache();
}
const LIVE = {
  CS_DATA_MODE: 'live',
  AUTH_SECRET: 'unit-only-auth-secret-not-a-real-value-0000000',
  AUTH_GOOGLE_ID: 'synthetic-client-id',
  AUTH_GOOGLE_SECRET: 'synthetic-client-secret',
  CS_OWNER_GOOGLE_SUB: undefined,
  CS_OWNER_EMAIL: undefined,
};

afterEach(() => {
  process.env = { ...saved };
  resetEnvCache();
  jar.clear();
});

describe('owner setup mode', () => {
  it('is on only in live mode with Google configured and no owner', () => {
    setEnv(LIVE);
    expect(ownerSetupMode()).toBe(true);
    setEnv({ ...LIVE, CS_OWNER_GOOGLE_SUB: '100000000000000000009' });
    expect(ownerSetupMode()).toBe(false);
    setEnv({ ...LIVE, CS_DATA_MODE: 'fake' });
    expect(ownerSetupMode()).toBe(false);
    setEnv({ ...LIVE, AUTH_GOOGLE_ID: undefined });
    expect(ownerSetupMode()).toBe(false);
  });

  it('grants no access: the normal sign-in callback still denies the unknown subject', () => {
    setEnv(LIVE);
    expect(signInCallback({ account: { provider: 'google' }, profile: { sub: '100000000000000000009' } })).toBe(false);
  });

  it('shows the subject back to the same browser only, and only in setup mode', async () => {
    setEnv(LIVE);
    await rememberSetupSubject('100000000000000000009');
    expect(await readSetupSubject()).toBe('100000000000000000009');
    setEnv({ ...LIVE, CS_OWNER_GOOGLE_SUB: '100000000000000000009' });
    expect(await readSetupSubject()).toBeNull();
  });

  it('a forged setup cookie is ignored', async () => {
    setEnv(LIVE);
    jar.set('cs-owner-setup', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.forged');
    expect(await readSetupSubject()).toBeNull();
  });

  it('with an owner email configured, only that verified email sees its subject', () => {
    setEnv({ ...LIVE, CS_OWNER_EMAIL: 'owner@example.com' });
    expect(setupAllowed({ email: 'owner@example.com', emailVerified: true })).toBe(true);
    expect(setupAllowed({ email: 'owner@example.com', emailVerified: false })).toBe(false);
    expect(setupAllowed({ email: 'someone@example.com', emailVerified: true })).toBe(false);
  });
});

describe('synthetic sign-in on Vercel previews', () => {
  it('is allowed only on an opted-in preview in fake mode, never production or live', async () => {
    const { syntheticSignInEnabled } = await import('@/lib/auth/policy');
    const base = { CS_DATA_MODE: 'fake', AUTH_GOOGLE_ID: undefined, CS_ALLOW_PREVIEW_SYNTHETIC: 'true' };
    setEnv({ ...base, VERCEL_ENV: 'preview' });
    expect(syntheticSignInEnabled()).toBe(true);
    setEnv({ ...base, VERCEL_ENV: 'preview', CS_ALLOW_PREVIEW_SYNTHETIC: undefined });
    expect(syntheticSignInEnabled()).toBe(false);
    // Fake mode in production is refused before any sign-in decision is made.
    setEnv({ ...base, VERCEL_ENV: 'production' });
    expect(() => syntheticSignInEnabled()).toThrow(/refused in production/);
    setEnv({ ...base, VERCEL_ENV: 'preview', CS_DATA_MODE: 'live' });
    expect(syntheticSignInEnabled()).toBe(false);
  });
});
