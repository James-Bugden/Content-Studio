'use client';

import { usePathname } from 'next/navigation';
import { GuardedLink } from './guarded-link';
import { NavigationBadge } from './navigation-counts';
import { ShellIcon } from './shell-icon';

/**
 * Primary navigation item (CS-006, UX-01, UX-04; CS-042).
 *
 * The active item carries aria-current="page" and is marked by a raised card
 * surface plus bold weight, so the current place is never signalled by
 * colour alone. Icon rail on wide screens, tab-bar cell on phones.
 * Navigation goes through GuardedLink so a dirty editor is never lost.
 */
export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname() ?? '';
  const active = href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <GuardedLink
      href={href}
      prefetch={false}
      aria-current={active ? 'page' : undefined}
      className="studio-nav-link"
      title={typeof children === 'string' ? children : undefined}
    >
      <ShellIcon name={href} />
      <span className="studio-nav-label">{children}</span>
      <NavigationBadge href={href} />
    </GuardedLink>
  );
}
