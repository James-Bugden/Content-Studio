import { NextResponse } from 'next/server';
import { isTestMode } from '@/replies/lib/server/test-mode';
import { resetMemoryStore } from '@/replies/lib/server/get-store';
import { resetServices } from '@/application/container';

export const dynamic = 'force-dynamic';

/**
 * Empties the browser-journey test double.
 *
 * The double is a singleton for a good reason: a journey spans several requests
 * and has to see its own writes. The cost is that it also spans several *tests*,
 * so one that creates a fact or disables a resource silently changes the world the
 * next one runs in. That is invisible when a file is run alone and appears as an
 * unrelated failure when the whole suite runs, which is the worst way for it to
 * show up.
 *
 * So each journey resets first, and order stops mattering.
 *
 * Outside `SR_TEST_MODE=e2e` this route does not exist: it answers 404, exactly as
 * an unrouted path would, rather than announcing that there is something here to
 * find.
 */
export function POST() {
  if (!isTestMode()) {
    return new NextResponse(null, { status: 404 });
  }

  resetMemoryStore();
  resetServices();
  return NextResponse.json(
    { reset: true },
    { headers: { 'Cache-Control': 'private, no-store, max-age=0' } },
  );
}
