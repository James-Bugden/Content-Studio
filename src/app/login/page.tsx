import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { continueAsSyntheticOwner, signInWithGoogle } from '@/app/actions/auth';
import { ClearLocalRecovery } from '@/components/auth/clear-local-recovery';
import { getActor } from '@/lib/auth';
import { googleSignInConfigured, syntheticSignInEnabled } from '@/lib/auth/policy';
import { ownerSetupMode, readSetupSubject } from '@/lib/auth/setup';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Sign in · Content Studio' };

/**
 * Sign-in page (CS-005). Owner-only; no signup, no account chooser hints. The
 * copy is the same for every visitor and never says whether anything exists.
 */
export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (await getActor()) redirect('/');
  const params = await searchParams;
  const signedOut = params.signed_out === '1';
  const google = googleSignInConfigured();
  const synthetic = syntheticSignInEnabled();
  const setup = ownerSetupMode();
  const setupSubject = setup && params.setup === '1' ? await readSetupSubject() : null;

  return (
    <main className="mx-auto max-w-md p-6">
      {signedOut ? <ClearLocalRecovery /> : null}
      <h1 className="text-2xl font-semibold">Sign in to Content Studio</h1>
      <p className="mt-2 text-ink-soft">This workspace is for its owner only. Other accounts cannot sign in.</p>
      {signedOut ? (
        <p role="status" className="mt-4 rounded border border-line bg-card p-3 text-sm">
          You are signed out. Unsaved work kept in this tab has been cleared.
        </p>
      ) : null}
      {setup ? (
        <section aria-labelledby="setup-h" className="mt-4 rounded border border-warn bg-warn-soft p-3 text-sm">
          <h2 id="setup-h" className="font-semibold">
            First-time setup
          </h2>
          {setupSubject ? (
            <>
              <p className="mt-1">Your Google account ID is below. Add it to the Vercel project as CS_OWNER_GOOGLE_SUB, redeploy, then sign in again.</p>
              <p className="mt-2 select-all rounded bg-card p-2 font-mono text-base" data-testid="owner-sub">
                {setupSubject}
              </p>
            </>
          ) : (
            <p className="mt-1">No owner is configured yet. Sign in with Google once to see the account ID to configure. Signing in does not grant access until then.</p>
          )}
        </section>
      ) : null}
      <div className="mt-6 flex flex-col gap-3">
        {google ? (
          <form action={signInWithGoogle}>
            <button type="submit" className="w-full rounded bg-green px-4 py-2 font-medium text-white">
              Sign in with Google
            </button>
          </form>
        ) : null}
        {synthetic ? (
          <form action={continueAsSyntheticOwner}>
            <button type="submit" className="w-full rounded border border-line bg-card px-4 py-2 font-medium">
              Continue as synthetic owner
            </button>
            <p className="mt-2 text-sm text-ink-soft">Local development with synthetic data only.</p>
          </form>
        ) : null}
        {!google && !synthetic ? <p className="text-sm text-ink-soft">Sign-in is not configured yet.</p> : null}
      </div>
    </main>
  );
}
