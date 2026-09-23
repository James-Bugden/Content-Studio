import { NavLink } from './nav-link';
import { ToastProvider } from './toaster';

/**
 * Application frame for every signed-in surface (CS-006, UX-01, UX-03).
 *
 * Server component: landmarks, skip link and the primary navigation. The only
 * client pieces are the nav items (they need the current path) and the toast
 * region. The account control is a slot so authentication stays with its own
 * module and never leaks into client code from here.
 */
export const PRIMARY_NAV = [
  { href: '/review', label: 'Review' },
  { href: '/visuals', label: 'Visuals' },
  { href: '/ready', label: 'Ready' },
  { href: '/schedule', label: 'Schedule' },
  { href: '/published', label: 'Published' },
  { href: '/reconcile', label: 'Reconcile' },
] as const;

export type AppShellProps = {
  children: React.ReactNode;
  /** Account and sign-out control, supplied by the auth module. */
  accountSlot?: React.ReactNode;
};

export function AppShell({ children, accountSlot }: AppShellProps) {
  return (
    <ToastProvider>
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-focal px-4 py-2 font-semibold text-ink focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to main content
      </a>
      <header className="border-b border-line bg-card">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
          <p className="text-base font-semibold tracking-tight">Content Studio</p>
          {accountSlot ? <div className="flex min-w-0 items-center gap-2 text-sm">{accountSlot}</div> : null}
        </div>
        <nav aria-label="Primary" className="mx-auto max-w-6xl px-2 pb-2">
          <ul className="flex flex-wrap gap-1">
            {PRIMARY_NAV.map((item) => (
              <li key={item.href}>
                <NavLink href={item.href}>{item.label}</NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto max-w-6xl px-4 py-6">
        {children}
      </main>
    </ToastProvider>
  );
}
