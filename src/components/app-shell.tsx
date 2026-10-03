import { NavLink } from './nav-link';
import { ToastProvider } from './toaster';

/**
 * Application frame for every signed-in surface (CS-006, UX-01, UX-03; CS-042).
 *
 * Server component: landmarks, skip link and the primary navigation. On wide
 * screens the navigation is a left sidebar; on phones the same list becomes a
 * bottom tab bar, so there is one Primary navigation landmark at every width.
 * The only client pieces are the nav items (they need the current path) and the
 * toast region. The account control is a slot so authentication stays with its
 * own module and never leaks into client code from here.
 */
export const PRIMARY_NAV = [
  { href: '/', label: 'Next up' },
  { href: '/review', label: 'Posts' },
  { href: '/backlog', label: 'Backlog' },
  { href: '/schedule', label: 'Calendar' },
  { href: '/published', label: 'Published' },
  { href: '/reconcile', label: 'Fix issues' },
  { href: '/replies', label: 'Replies' },
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
        className="sr-only z-50 rounded-md bg-primary px-4 py-2 font-semibold text-white focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to main content
      </a>
      <div className="min-h-screen md:grid md:grid-cols-[13.5rem_minmax(0,1fr)]">
        <header className="flex items-center justify-between gap-3 border-b border-line bg-side px-4 py-3 md:sticky md:top-0 md:h-screen md:flex-col md:items-stretch md:justify-start md:gap-4 md:border-r md:border-b-0 md:px-2.5 md:py-4">
          <p className="flex items-center gap-2 px-1.5 text-sm font-semibold">
            <span aria-hidden="true" className="grid size-6 place-items-center rounded-md bg-primary text-[11px] font-semibold text-white">
              CS
            </span>
            Content Studio
          </p>
          <nav
            aria-label="Primary"
            className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-card pb-[env(safe-area-inset-bottom)] md:static md:z-auto md:border-0 md:bg-transparent md:pb-0"
          >
            <ul className="flex overflow-x-auto md:flex-col md:gap-0.5 md:overflow-visible">
              {PRIMARY_NAV.map((item) => (
                <li
                  key={item.href}
                  className={`min-w-[4.75rem] flex-1 md:min-w-0 md:flex-none ${item.href === '/replies' ? 'md:mt-3 md:border-t md:border-line md:pt-3' : ''}`}
                >
                  <NavLink href={item.href}>{item.label}</NavLink>
                </li>
              ))}
            </ul>
          </nav>
          {accountSlot ? <div className="flex min-w-0 items-center gap-2 text-sm md:mt-auto md:px-1.5">{accountSlot}</div> : null}
        </header>
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl min-w-0 px-4 pt-6 pb-24 md:px-8 md:pb-10">
          {children}
        </main>
      </div>
    </ToastProvider>
  );
}
