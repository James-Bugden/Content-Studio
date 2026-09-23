'use client';

import { clearLocalRecovery } from '@/lib/client/local-recovery';

/**
 * Sign-out form (SEC-09). Clears tab-local recovery before the server action
 * expires the session cookies and redirects to /login.
 */
export function SignOutButton({ action }: { action: () => Promise<void> }) {
  return (
    <form action={action} onSubmit={() => clearLocalRecovery()}>
      <button type="submit" className="rounded border px-3 py-1.5 text-sm">
        Sign out
      </button>
    </form>
  );
}
