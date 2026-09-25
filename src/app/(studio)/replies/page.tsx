import Link from 'next/link';
import { Workspace } from '@/replies/components/replies/Workspace';
import { getOwnerSession } from '@/replies/lib/auth/owner';
import { getStore } from '@/replies/lib/server/get-store';
import { isTestMode, TEST_OWNER_ID } from '@/replies/lib/server/test-mode';
import { publicConfig } from '@/replies/lib/config/env';
import { NAV, RECORD } from '@/replies/lib/workspace/copy';

export const dynamic = 'force-dynamic';

/**
 * The workspace page.
 *
 * Signed out, it says so and keeps the door to sign-in open. It does not render
 * the workspace with empty data and let every action fail, and it does not claim a
 * draft is saved anywhere (D12).
 *
 * The progress counts and the fact-eligibility flag are read on the server so the
 * first paint already shows the real numbers rather than zeros that correct
 * themselves a moment later.
 */
export default async function HomePage() {
  const session = isTestMode() ? await testSession() : await getOwnerSession();

  if (!session) {
    return (
      <main className="mx-auto max-w-[750px] px-4 py-16">
        <h1 className="text-xl font-semibold">{NAV.title}</h1>
        <p className="mt-2 text-ink-soft">{RECORD.signedOut}</p>
        <Link href="/login" className="mt-4 inline-block text-green underline">
          Sign in
        </Link>
      </main>
    );
  }

  const store = getStore(session);
  const [progress, hasEligibleFacts] = await Promise.all([
    store.dailyCounts(publicConfig().timezone).catch(() => null),
    store.hasEligibleFacts().catch(() => false),
  ]);

  return <Workspace initialProgress={progress} hasEligibleFacts={hasEligibleFacts} />;
}

/** The browser-journey session. See `src/lib/server/test-mode.ts`. */
async function testSession() {
  return { userId: TEST_OWNER_ID, supabase: null as never };
}

