'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { AppError } from '@/domain/errors';
import { signIn } from '@/lib/auth/config';
import { SYNTHETIC_SUBJECTS, googleSignInConfigured, syntheticSignInEnabled } from '@/lib/auth/policy';
import { TEST_COOKIE_NAME, signTestCookie, testCookieOptions } from '@/lib/auth/test-cookie';

/**
 * Sign-in and sign-out server actions (CS-005). Next.js checks the Origin of
 * every server action against the host; these actions add no private data.
 */

async function isHttps(): Promise<boolean> {
  const h = await headers();
  return (h.get('x-forwarded-proto') ?? '').split(',')[0]?.trim() === 'https';
}

export async function signInWithGoogle(): Promise<void> {
  if (!googleSignInConfigured()) throw new AppError('CONFIG_MISSING', { provider: 'auth' });
  await signIn('google', { redirectTo: '/' });
}

/** Local development only (fake mode, `next dev`, no Google client). Refused elsewhere. */
export async function continueAsSyntheticOwner(): Promise<void> {
  if (!syntheticSignInEnabled()) throw new AppError('FORBIDDEN');
  const store = await cookies();
  store.set(TEST_COOKIE_NAME, await signTestCookie(SYNTHETIC_SUBJECTS.owner), testCookieOptions(await isHttps()));
  redirect('/');
}

/**
 * JWT sessions hold no server state, so signing out is expiring every session
 * cookie this app sets. Tab-local recovery is cleared in the browser by the
 * sign-out form before this runs, and again on the signed-out login page.
 */
export async function signOutAction(): Promise<void> {
  const store = await cookies();
  for (const { name } of store.getAll()) {
    if (name === TEST_COOKIE_NAME || /^(__Secure-|__Host-)?authjs\./.test(name)) {
      store.set(name, '', { path: '/', maxAge: 0, httpOnly: true, sameSite: 'lax', secure: name.startsWith('__') || (await isHttps()) });
    }
  }
  redirect('/login?signed_out=1');
}
