import 'server-only';
import type { NextRequest, NextResponse } from 'next/server';
import { requireOwner, type OwnerSession } from '@/replies/lib/auth/owner';
import { isTestMode, TEST_OWNER_ID } from './test-mode';
import { route } from './http';

/**
 * Wraps a route so that it cannot run without a verified owner session.
 *
 * The owner check is repeated here even though row-level security enforces the
 * same thing, because the two failures look different to the caller. RLS returns
 * an empty result, which a route could mistake for "nothing found" and render as a
 * normal empty state. This returns 401 and says so.
 */
export function ownerRoute(
  handler: (
    request: NextRequest,
    context: { requestId: string; session: OwnerSession },
  ) => Promise<NextResponse>,
) {
  return route(async (request, { requestId }) => {
    // The browser journeys run a real production build with no database and no
    // credentials, so there is no session to verify. The bypass is gated on an
    // exact environment value that nothing outside the harness and CI sets, and
    // it hands back a stub client rather than a real one, so there is no path
    // from here to live data even by mistake.
    const session = isTestMode()
      ? ({ userId: TEST_OWNER_ID, supabase: null as never } satisfies OwnerSession)
      : await requireOwner();
    return handler(request, { requestId, session });
  });
}

interface PostgrestErrorLike {
  code?: string;
  message?: string;
}

/**
 * Turns a PostgREST RPC result into a value or a throw.
 *
 * `supabase-js` returns errors rather than throwing them, which is easy to ignore
 * by accident. Funnelling every RPC through here means a route cannot return 200
 * with an undefined body because nobody checked `error`.
 */
export function unwrapRpc<T>(result: { data: T | null; error: PostgrestErrorLike | null }): T {
  if (result.error) {
    // The SQLSTATE is carried through so `toErrorResponse` can map SR401/SR404/SR409
    // onto a status code. The message is not forwarded: Postgres messages name
    // constraints and sometimes values.
    const error = new Error('database operation failed') as Error & { code?: string };
    error.code = result.error.code ?? 'XX000';
    throw error;
  }
  if (result.data === null) {
    const error = new Error('database returned no result') as Error & { code?: string };
    error.code = 'XX000';
    throw error;
  }
  return result.data;
}

