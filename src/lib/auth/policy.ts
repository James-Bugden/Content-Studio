import 'server-only';
import { serverEnv, type ServerEnv } from '@/lib/env';

/**
 * Authorisation policy (CS-005, MASTER-SPEC section 3).
 *
 * Identity is the immutable Google `sub`, held only in server configuration.
 * Email is never sufficient on its own; when CS_OWNER_EMAIL is configured it is
 * an extra check that can only deny, never grant. Default deny.
 */
export type Role = 'owner' | 'viewer';

/** Synthetic subjects for fake mode and tests. Visibly fake; never real accounts. */
export const SYNTHETIC_SUBJECTS = {
  owner: '100000000000000000001',
  viewer: '100000000000000000002',
  stranger: '100000000000000000003',
} as const;

export type ProfileHints = { email?: string | null; emailVerified?: boolean | null };

function viewerSubjects(env: ServerEnv): string[] {
  return (env.CS_VIEWER_GOOGLE_SUBS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Owner iff `sub` equals CS_OWNER_GOOGLE_SUB; viewer iff listed in
 * CS_VIEWER_GOOGLE_SUBS; otherwise null. In fake mode with no owner configured,
 * the synthetic owner and viewer subjects stand in for the configuration.
 *
 * Optional profile hints: a verified email that differs from CS_OWNER_EMAIL
 * denies the owner role (defence in depth). An unverified email is ignored.
 */
export function roleForSubject(sub: string, profile?: ProfileHints): Role | null {
  if (typeof sub !== 'string' || sub.length === 0) return null;
  const env = serverEnv();
  let owner = env.CS_OWNER_GOOGLE_SUB;
  let viewers = viewerSubjects(env);
  if (env.CS_DATA_MODE === 'fake' && !owner) {
    owner = SYNTHETIC_SUBJECTS.owner;
    viewers = [...viewers, SYNTHETIC_SUBJECTS.viewer];
  }
  if (owner && sub === owner) {
    if (env.CS_OWNER_EMAIL && profile?.emailVerified === true && typeof profile.email === 'string') {
      if (profile.email.trim().toLowerCase() !== env.CS_OWNER_EMAIL.trim().toLowerCase()) return null;
    }
    return 'owner';
  }
  if (viewers.includes(sub)) return 'viewer';
  return null;
}

/** Owner satisfies viewer; viewer satisfies only viewer. */
export function roleSatisfies(role: Role, minRole: Role): boolean {
  return minRole === 'viewer' ? role === 'owner' || role === 'viewer' : role === 'owner';
}

/**
 * The e2e test sign-in route and cookie: fake data, e2e test mode, never production.
 */
export function testAuthEnabled(env: ServerEnv = serverEnv()): boolean {
  return env.CS_DATA_MODE === 'fake' && env.CS_TEST_MODE === 'e2e' && env.VERCEL_ENV !== 'production';
}

/**
 * "Continue as synthetic owner": local `npm run dev`, or a Vercel preview that
 * explicitly opts in, with fake data, no Google client, and never production.
 */
export function syntheticSignInEnabled(env: ServerEnv = serverEnv()): boolean {
  if (env.CS_DATA_MODE !== 'fake' || env.AUTH_GOOGLE_ID || env.VERCEL_ENV === 'production') return false;
  if (process.env.NODE_ENV === 'development') return true;
  // Vercel preview demo on synthetic data only. Preview URLs sit behind Vercel's
  // own deployment protection, and fake mode is refused in production.
  return env.VERCEL_ENV === 'preview' && process.env.CS_ALLOW_PREVIEW_SYNTHETIC === 'true';
}

/** Whether the signed test cookie may be honoured at all in this process. */
export function testCookieAccepted(env: ServerEnv = serverEnv()): boolean {
  return testAuthEnabled(env) || syntheticSignInEnabled(env);
}

/** Google sign-in is available only when the full Auth.js configuration is present. */
export function googleSignInConfigured(env: ServerEnv = serverEnv()): boolean {
  return Boolean(env.AUTH_SECRET && env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET);
}
