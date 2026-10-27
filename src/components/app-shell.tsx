import { NavLink } from './nav-link';
import { NavMore } from './nav-more';
import { ToastProvider } from './toaster';
import { NavigationCountsProvider } from './navigation-counts';
import { ShellFrame } from './shell-frame';

export const PRIMARY_NAV = [
  { href: '/', label: 'Next up' },
  { href: '/review', label: 'Posts' },
  { href: '/schedule', label: 'Calendar' },
  { href: '/backlog', label: 'Backlog' },
  { href: '/published', label: 'Published' },
  { href: '/reconcile', label: 'Fix issues' },
  { href: '/replies', label: 'Replies' },
] as const;

export type AppShellProps = {
  children: React.ReactNode;
  accountSlot?: React.ReactNode;
  statusSlot?: React.ReactNode;
};

/** Counts stay inside navigation, outside streamed page/editor boundaries. */
export function AppShell({ children, accountSlot, statusSlot }: AppShellProps) {
  return <ToastProvider>
    <a href="#main" className="sr-only z-50 rounded-md bg-primary px-4 py-2 font-semibold text-white focus:not-sr-only focus:fixed focus:top-2 focus:left-2">Skip to main content</a>
    <ShellFrame accountSlot={accountSlot} statusSlot={statusSlot} navigation={
      <nav aria-label="Primary" className="studio-nav">
        <NavigationCountsProvider>
          <ul className="studio-nav-list">
            {PRIMARY_NAV.map((item, i) => <li key={item.href} className={i >= 4 ? 'studio-secondary-nav' : ''}>
              <NavLink href={item.href}>{item.label}</NavLink>
            </li>)}
            <li className="studio-more"><NavMore items={PRIMARY_NAV.slice(4)} /></li>
          </ul>
        </NavigationCountsProvider>
      </nav>
    }>{children}</ShellFrame>
  </ToastProvider>;
}
