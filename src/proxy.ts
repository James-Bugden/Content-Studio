import { NextResponse, type NextRequest } from 'next/server';

/**
 * Convenience redirect only (CS-005). Page requests without any session cookie
 * go to /login, with no hint of what was asked for, so the redirect says nothing
 * about whether a resource exists. It checks cookie presence, not validity: every
 * page, route and action still calls requireActor or requireMutation. API routes
 * are excluded and answer 401 JSON themselves.
 */
const SESSION_COOKIE = /^(__Secure-)?authjs\.session-token(\.\d+)?$/;
const TEST_COOKIE = 'cs-test-auth';

export function proxy(request: NextRequest) {
  const hasSession = request.cookies.getAll().some(({ name }) => name === TEST_COOKIE || SESSION_COOKIE.test(name));
  if (hasSession) return NextResponse.next();
  return NextResponse.redirect(new URL('/login', request.url));
}

export const config = {
  // Everything except /login, the fake-mode-only /dev/states gallery (it 404s otherwise), all API routes, Next internals and static files.
  // A path containing a dot is treated as a static file.
  matcher: ['/((?!login|dev/states|api/|_next/static|_next/image|.*\\..*).*)'],
};
