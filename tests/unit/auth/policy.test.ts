import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetEnvCache } from '@/lib/env';
import { SYNTHETIC_SUBJECTS, roleForSubject, roleSatisfies, syntheticSignInEnabled, testAuthEnabled } from '@/lib/auth/policy';
import { jwtCallback, sessionCallback, signInCallback } from '@/lib/auth/callbacks';

/**
 * CS-005 authorisation policy: identity is the Google `sub`; email can only deny.
 * Synthetic subjects only (public repo).
 */
const OWNER = '200000000000000000001';
const VIEWER_A = '200000000000000000002';
const VIEWER_B = '200000000000000000004';
const STRANGER = '200000000000000000003';

const saved = { ...process.env };

function setEnv(values: Record<string, string | undefined>) {
  const env = process.env as Record<string, string | undefined>;
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  resetEnvCache();
}

beforeEach(() => {
  setEnv({
    CS_DATA_MODE: 'live',
    CS_OWNER_GOOGLE_SUB: OWNER,
    CS_VIEWER_GOOGLE_SUBS: ` ${VIEWER_A} , ${VIEWER_B},`,
    CS_OWNER_EMAIL: undefined,
    CS_TEST_MODE: undefined,
    VERCEL_ENV: undefined,
    AUTH_GOOGLE_ID: undefined,
  });
});

afterEach(() => {
  process.env = { ...saved };
  resetEnvCache();
});

describe('roleForSubject', () => {
  it('maps owner, viewers and strangers by sub', () => {
    expect(roleForSubject(OWNER)).toBe('owner');
    expect(roleForSubject(VIEWER_A)).toBe('viewer');
    expect(roleForSubject(VIEWER_B)).toBe('viewer');
    expect(roleForSubject(STRANGER)).toBeNull();
    expect(roleForSubject('')).toBeNull();
  });

  it('does not accept prefixes, suffixes or list syntax as a subject', () => {
    expect(roleForSubject(`${OWNER} `)).toBeNull();
    expect(roleForSubject(OWNER.slice(0, -1))).toBeNull();
    expect(roleForSubject(`${VIEWER_A},${VIEWER_B}`)).toBeNull();
  });

  it('denies the owner sub when a verified email differs from CS_OWNER_EMAIL', () => {
    setEnv({ CS_OWNER_EMAIL: 'owner@example.com' });
    expect(roleForSubject(OWNER, { email: 'someone@example.com', emailVerified: true })).toBeNull();
    expect(roleForSubject(OWNER, { email: 'OWNER@example.com', emailVerified: true })).toBe('owner');
    // Unverified email is not evidence either way; the sub decides.
    expect(roleForSubject(OWNER, { email: 'someone@example.com', emailVerified: false })).toBe('owner');
  });

  it('never grants by email alone', () => {
    setEnv({ CS_OWNER_EMAIL: 'owner@example.com' });
    expect(roleForSubject(STRANGER, { email: 'owner@example.com', emailVerified: true })).toBeNull();
  });

  it('uses synthetic subjects only in fake mode with no owner configured', () => {
    setEnv({ CS_DATA_MODE: 'fake', CS_OWNER_GOOGLE_SUB: undefined, CS_VIEWER_GOOGLE_SUBS: undefined });
    expect(roleForSubject(SYNTHETIC_SUBJECTS.owner)).toBe('owner');
    expect(roleForSubject(SYNTHETIC_SUBJECTS.viewer)).toBe('viewer');
    expect(roleForSubject(SYNTHETIC_SUBJECTS.stranger)).toBeNull();

    setEnv({ CS_DATA_MODE: 'live' });
    expect(roleForSubject(SYNTHETIC_SUBJECTS.owner)).toBeNull();
    expect(roleForSubject(SYNTHETIC_SUBJECTS.viewer)).toBeNull();

    setEnv({ CS_DATA_MODE: 'fake', CS_OWNER_GOOGLE_SUB: OWNER });
    expect(roleForSubject(SYNTHETIC_SUBJECTS.owner)).toBeNull();
  });

  it('owner satisfies viewer; viewer does not satisfy owner', () => {
    expect(roleSatisfies('owner', 'viewer')).toBe(true);
    expect(roleSatisfies('owner', 'owner')).toBe(true);
    expect(roleSatisfies('viewer', 'viewer')).toBe(true);
    expect(roleSatisfies('viewer', 'owner')).toBe(false);
  });
});

describe('test-mode switches', () => {
  it('test auth needs fake data, e2e mode and a non-production deployment', () => {
    setEnv({ CS_DATA_MODE: 'fake', CS_TEST_MODE: 'e2e' });
    expect(testAuthEnabled()).toBe(true);
    setEnv({ CS_TEST_MODE: 'ci' });
    expect(testAuthEnabled()).toBe(false);
    setEnv({ CS_TEST_MODE: 'e2e', CS_DATA_MODE: 'live' });
    expect(testAuthEnabled()).toBe(false);
    setEnv({ CS_DATA_MODE: 'live', VERCEL_ENV: 'production' });
    expect(testAuthEnabled()).toBe(false);
  });

  it('synthetic sign-in is off outside the development server', () => {
    setEnv({ CS_DATA_MODE: 'fake' });
    // vitest runs with NODE_ENV=test
    expect(syntheticSignInEnabled()).toBe(false);
  });
});

describe('Auth.js callbacks', () => {
  const google = { provider: 'google' };

  it('signIn denies an unknown sub and creates nothing', () => {
    expect(signInCallback({ account: google, profile: { sub: STRANGER, email: 'x@example.com', email_verified: true } })).toBe(false);
  });

  it('signIn allows owner and viewer subs', () => {
    expect(signInCallback({ account: google, profile: { sub: OWNER } })).toBe(true);
    expect(signInCallback({ account: google, profile: { sub: VIEWER_A } })).toBe(true);
  });

  it('signIn denies a missing sub, another provider, or an owner with a mismatched verified email', () => {
    expect(signInCallback({ account: google, profile: { email: 'owner@example.com' } })).toBe(false);
    expect(signInCallback({ account: { provider: 'github' }, profile: { sub: OWNER } })).toBe(false);
    setEnv({ CS_OWNER_EMAIL: 'owner@example.com' });
    expect(signInCallback({ account: google, profile: { sub: OWNER, email: 'other@example.com', email_verified: true } })).toBe(false);
  });

  it('jwt keeps sub and role only, dropping profile data and provider tokens', () => {
    const token = jwtCallback({
      token: { sub: OWNER, name: 'Synthetic', email: 'owner@example.com', picture: 'x', access_token: 'tok' } as { sub: string },
      profile: { sub: OWNER, email: 'owner@example.com', email_verified: true },
    });
    expect(token).toEqual({ sub: OWNER, role: 'owner' });
    const refreshed = jwtCallback({ token: { sub: OWNER, role: 'admin' } });
    expect(refreshed).toEqual({ sub: OWNER, role: null });
  });

  it('session carries the subject only', () => {
    const session = sessionCallback({
      session: { expires: '2026-01-01T00:00:00.000Z', user: { email: 'owner@example.com', name: 'x' } },
      token: { sub: OWNER },
    });
    expect(session).toEqual({ expires: '2026-01-01T00:00:00.000Z', user: { id: OWNER } });
  });
});
