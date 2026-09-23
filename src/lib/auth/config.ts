import 'server-only';
import NextAuth, { type NextAuthConfig } from 'next-auth';
import Google from 'next-auth/providers/google';
import { serverEnv } from '@/lib/env';
import { jwtCallback, sessionCallback, signInCallback } from './callbacks';
import { ownerSetupMode, rememberSetupSubject, setupAllowed } from './setup';
import { SESSION_MAX_AGE_SECONDS } from './test-cookie';

/**
 * Auth.js configuration (CS-005): Google OIDC, JWT sessions, no adapter and so no
 * account storage or signup. Built lazily per request so configuration is read at
 * runtime, not at build time. Default scopes only (openid, email, profile); no
 * account-chooser prompt or login hint is sent.
 */
function buildConfig(): NextAuthConfig {
  const env = serverEnv();
  const secureCookies = env.VERCEL_ENV === 'production' ? true : undefined;
  return {
    secret: env.AUTH_SECRET,
    trustHost: true,
    providers: env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET ? [Google({ clientId: env.AUTH_GOOGLE_ID, clientSecret: env.AUTH_GOOGLE_SECRET })] : [],
    session: { strategy: 'jwt', maxAge: SESSION_MAX_AGE_SECONDS },
    jwt: { maxAge: SESSION_MAX_AGE_SECONDS },
    ...(secureCookies === undefined ? {} : { useSecureCookies: secureCookies }),
    pages: { signIn: '/login', error: '/login' },
    callbacks: {
      signIn: async ({ account, profile }) => {
        // First-run setup: no access is granted; the account is shown its own subject.
        if (ownerSetupMode(env) && account?.provider === 'google' && typeof profile?.sub === 'string') {
          const hints = { email: typeof profile.email === 'string' ? profile.email : null, emailVerified: typeof profile.email_verified === 'boolean' ? profile.email_verified : null };
          if (setupAllowed(hints, env)) await rememberSetupSubject(profile.sub);
          return '/login?setup=1';
        }
        return signInCallback({ account, profile });
      },
      jwt: ({ token, profile }) => jwtCallback({ token, profile }),
      session: ({ session, token }) => sessionCallback({ session, token }) as typeof session,
    },
  };
}

export const { handlers, auth, signIn, signOut } = NextAuth(() => buildConfig());
