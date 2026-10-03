'use client';

import { clearLocalRecovery } from '@/lib/client/local-recovery';

/**
 * Sign-out form (SEC-09). Clears tab-local recovery before the server action
 * expires the session cookies and redirects to /login.
 */
export function SignOutButton({ action }: { action: () => Promise<void> }) {
  return (
    <form action={action} onSubmit={() => clearLocalRecovery()}>
      <button type="submit" className="min-h-9 rounded-md border border-line bg-card px-2.5 text-sm text-ink-soft hover:text-ink">
        Sign out
      </button>
    </form>
  );
}
