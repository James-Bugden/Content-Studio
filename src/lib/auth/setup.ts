import 'server-only';
import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';
import { serverEnv, type ServerEnv } from '@/lib/env';
import { googleSignInConfigured } from './policy';

/**
 * First-run owner setup (CS-019).
 *
 * The owner is identified by an immutable Google `sub` that nobody knows by
 * heart. Until CS_OWNER_GOOGLE_SUB is configured, a Google sign-in grants no
 * access at all; instead the login page shows the signed-in account its own
 * subject so it can be copied into configuration. If CS_OWNER_EMAIL is set, only
 * a verified matching email is shown its subject. Once an owner is configured
 * this mode switches off permanently and sign-in behaves normally.
 */
const COOKIE = 'cs-owner-setup';
const TTL_SECONDS = 10 * 60;

export function ownerSetupMode(env: ServerEnv = serverEnv()): boolean {
  return env.CS_DATA_MODE === 'live' && googleSignInConfigured(env) && !env.CS_OWNER_GOOGLE_SUB;
}

export function setupAllowed(profile: { email?: string | null; emailVerified?: boolean | null }, env: ServerEnv = serverEnv()): boolean {
  if (!env.CS_OWNER_EMAIL) return true;
  return profile.emailVerified === true && typeof profile.email === 'string' && profile.email.trim().toLowerCase() === env.CS_OWNER_EMAIL.trim().toLowerCase();
}

function key(): Uint8Array {
  return new TextEncoder().encode(serverEnv().AUTH_SECRET ?? '');
}

export async function rememberSetupSubject(sub: string): Promise<void> {
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setAudience('content-studio/owner-setup')
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(key());
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: serverEnv().VERCEL_ENV !== undefined, path: '/login', maxAge: TTL_SECONDS });
}

export async function readSetupSubject(): Promise<string | null> {
  if (!ownerSetupMode()) return null;
  const value = (await cookies()).get(COOKIE)?.value;
  if (!value) return null;
  try {
    const { payload } = await jwtVerify(value, key(), { algorithms: ['HS256'], audience: 'content-studio/owner-setup' });
    return typeof payload.sub === 'string' && /^\d{5,40}$/.test(payload.sub) ? payload.sub : null;
  } catch {
    return null;
  }
}
