import 'server-only';
import { roleForSubject, type Role } from './policy';

/**
 * Auth.js callbacks, kept free of the Auth.js runtime so they are unit-testable.
 *
 * - signIn denies any Google account whose `sub` has no configured role. There is
 *   no signup: nothing is created for an unknown account.
 * - The JWT keeps `sub` and `role` only. Name, email, picture and provider tokens
 *   are dropped; Google APIs use a service account, never the user's token.
 * - The session exposes the subject only. The role is recomputed from server
 *   configuration on every request (see getActor), so revoking a subject in
 *   configuration takes effect without waiting for the session to expire.
 */
type GoogleProfileLike = { sub?: unknown; email?: unknown; email_verified?: unknown } | undefined | null;

function profileHints(profile: GoogleProfileLike) {
  return {
    email: typeof profile?.email === 'string' ? profile.email : null,
    emailVerified: typeof profile?.email_verified === 'boolean' ? profile.email_verified : null,
  };
}

export function signInCallback(params: { account?: { provider?: string } | null; profile?: GoogleProfileLike }): boolean {
  if (params.account?.provider !== 'google') return false;
  const sub = params.profile?.sub;
  if (typeof sub !== 'string' || sub.length === 0) return false;
  return roleForSubject(sub, profileHints(params.profile)) !== null;
}

export type SlimToken = { sub?: string; role?: Role | null };

export function jwtCallback(params: { token: { sub?: string; role?: unknown }; profile?: GoogleProfileLike }): SlimToken {
  if (params.profile) {
    const sub = typeof params.profile.sub === 'string' ? params.profile.sub : undefined;
    return { sub, role: sub ? roleForSubject(sub, profileHints(params.profile)) : null };
  }
  const role = params.token.role === 'owner' || params.token.role === 'viewer' ? params.token.role : null;
  return { sub: params.token.sub, role };
}

export function sessionCallback<S extends { expires: string }>(params: { session: S; token: { sub?: string } }) {
  return { expires: params.session.expires, user: { id: params.token.sub } };
}
