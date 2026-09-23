import { redirect } from 'next/navigation';
import { signOutAction } from '@/app/actions/auth';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { getActor } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** Home. Anonymous and no-role sessions go to /login; the proxy redirect is not relied on (SEC-05). */
export default async function Home() {
  const actor = await getActor();
  if (!actor) redirect('/login');
  return (
    <main className="mx-auto max-w-3xl p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Content Studio</h1>
          <p className="mt-2 text-ink-soft">Owner-only control surface over the content Sheet, Drive and Typefully.</p>
          {actor.role === 'viewer' ? <p className="mt-2 text-sm text-ink-soft">You have read-only access.</p> : null}
        </div>
        <SignOutButton action={signOutAction} />
      </div>
    </main>
  );
}
