import 'server-only';
import { cookies } from 'next/headers';
import { AppError } from '@/domain/errors';
import type { Actor } from '@/domain/mutation';
import { serverEnv } from '@/lib/env';
import { auth } from './config';
import { googleSignInConfigured, roleForSubject, roleSatisfies, testCookieAccepted, type Role } from './policy';
import { TEST_COOKIE_NAME, verifyTestCookie } from './test-cookie';

/**
 * Server authentication boundary (CS-005, SEC-05..SEC-09).
 *
 * Every page, route handler and server action that touches private content calls
 * requireActor (reads) or requireMutation (writes). The proxy redirect is a
 * convenience only and is never relied on for protection.
 */
export { roleForSubject } from './policy';
export type { Role } from './policy';

/** The authenticated subject, before role resolution. `role` is null for a known session with no access. */
type Principal = { sub: string; role: Role | null };

async function sessionSubject(): Promise<string | null> {
  const env = serverEnv();
  if (testCookieAccepted(env)) {
    const store = await cookies();
    const sub = await verifyTestCookie(store.get(TEST_COOKIE_NAME)?.value);
    if (sub) return sub;
  }
  if (!googleSignInConfigured(env)) return null;
  try {
    const session = await auth();
    const id = session?.user?.id;
    return typeof id === 'string' && id.length > 0 ? id : null;
  } catch (error) {
    // Fail closed: an unreadable session is no session. Log the kind only.
    console.error('auth: session read failed', error instanceof Error ? error.name : 'unknown');
    return null;
  }
}

async function principal(): Promise<Principal | null> {
  const sub = await sessionSubject();
  if (!sub) return null;
  return { sub, role: roleForSubject(sub) };
}

/** The current actor, or null when anonymous or when the subject has no role. */
export async function getActor(): Promise<Actor | null> {
  const p = await principal();
  return p && p.role ? { sub: p.sub, role: p.role } : null;
}

/** AUTH_REQUIRED without a session; FORBIDDEN when the role is insufficient. Owner satisfies viewer. */
export async function requireActor(minRole: Role): Promise<Actor> {
  const p = await principal();
  if (!p) throw new AppError('AUTH_REQUIRED');
  if (!p.role || !roleSatisfies(p.role, minRole)) throw new AppError('FORBIDDEN');
  return { sub: p.sub, role: p.role };
}

function appOrigin(request: Request): string {
  const base = serverEnv().APP_BASE_URL;
  return new URL(base ?? request.url).origin;
}

/**
 * Same-origin check for every mutation. `Origin` must equal the app origin; when
 * the browser sent no Origin, `Sec-Fetch-Site: same-origin` is required. A literal
 * `null` origin (sandboxed frames, some redirects) is refused.
 */
export function assertSameOrigin(request: Request): void {
  const expected = appOrigin(request);
  const origin = request.headers.get('origin');
  if (origin !== null) {
    if (origin !== 'null' && origin === expected) return;
    throw new AppError('FORBIDDEN', { reason: 'cross_origin' });
  }
  if (request.headers.get('sec-fetch-site') === 'same-origin') return;
  throw new AppError('FORBIDDEN', { reason: 'cross_origin' });
}

/** Every mutation route: same origin first, then an owner session. */
export async function requireMutation(request: Request): Promise<Actor> {
  assertSameOrigin(request);
  return requireActor('owner');
}
