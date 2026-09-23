import { redirect } from 'next/navigation';
import { signOutAction } from '@/app/actions/auth';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { AppShell } from '@/components/app-shell';
import { getActor } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * Frame for every workflow surface (CS-006). Every studio page is private: the
 * layout checks the session itself rather than relying on the proxy redirect
 * (SEC-05), and each page and route still checks again for its own data.
 */
export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  const actor = await getActor();
  if (!actor) redirect('/login');
  return (
    <AppShell
      accountSlot={
        <div className="flex items-center gap-3 text-sm">
          <span className="text-ink-soft">{actor.role === 'owner' ? 'Owner' : 'Read only'}</span>
          <SignOutButton action={signOutAction} />
        </div>
      }
    >
      {children}
    </AppShell>
  );
}
