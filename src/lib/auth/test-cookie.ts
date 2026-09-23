import 'server-only';
import { randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { serverEnv } from '@/lib/env';
import { syntheticSignInEnabled, testCookieAccepted } from './policy';

/**
 * Signed test-identity cookie (CS-005).
 *
 * Used only by POST /api/test-auth (fake + e2e mode) and the local synthetic
 * sign-in button (fake mode, `next dev`, no Google client). It carries a subject
 * only; the role is always recomputed from server configuration on read, so a
 * cookie can never grant more than the configuration allows. Outside those modes
 * the cookie is ignored entirely.
 */
export const TEST_COOKIE_NAME = 'cs-test-auth';
export const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

const ISSUER = 'content-studio/test-auth';
const AUDIENCE = 'content-studio';

// Local development only: a per-process key when AUTH_SECRET is not set. It lives
// on globalThis because `next dev` loads pages and route handlers as separate
// module graphs; a module-level variable gave each graph its own key, so a cookie
// signed on the sign-in page was rejected by every API route.
const DEV_KEY = Symbol.for('content-studio.dev-auth-key');

function devKey(): Uint8Array {
  const g = globalThis as unknown as Record<symbol, Uint8Array | undefined>;
  g[DEV_KEY] ??= new Uint8Array(randomBytes(32));
  return g[DEV_KEY];
}

function signingKey(): Uint8Array | null {
  const env = serverEnv();
  if (env.AUTH_SECRET) return new TextEncoder().encode(env.AUTH_SECRET);
  if (syntheticSignInEnabled(env)) return devKey();
  return null;
}

export async function signTestCookie(sub: string, maxAgeSeconds: number = SESSION_MAX_AGE_SECONDS): Promise<string> {
  const key = signingKey();
  if (!key) throw new Error('Test sign-in needs AUTH_SECRET');
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + maxAgeSeconds)
    .sign(key);
}

/** Returns the subject of a valid cookie, or null. Never throws. */
export async function verifyTestCookie(value: string | undefined): Promise<string | null> {
  if (!value || !testCookieAccepted()) return null;
  const key = signingKey();
  if (!key) return null;
  try {
    const { payload } = await jwtVerify(value, key, { algorithms: ['HS256'], issuer: ISSUER, audience: AUDIENCE });
    return typeof payload.sub === 'string' && payload.sub.length > 0 ? payload.sub : null;
  } catch {
    return null;
  }
}

/** Cookie attributes: httpOnly, lax, secure whenever served over https. */
export function testCookieOptions(secure: boolean, maxAge: number = SESSION_MAX_AGE_SECONDS) {
  return { httpOnly: true, sameSite: 'lax' as const, secure, path: '/', maxAge };
}
