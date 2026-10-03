'use client';

import { usePathname } from 'next/navigation';
import { GuardedLink } from './guarded-link';

/**
 * Primary navigation item (CS-006, UX-01, UX-04; CS-042).
 *
 * The active item carries aria-current="page" and is marked by a raised card
 * surface plus semibold weight, so the current place is never signalled by
 * colour alone. Sidebar row on wide screens, tab-bar cell on phones.
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
      className={[
        'flex min-h-14 items-center justify-center px-2 text-center text-xs whitespace-nowrap transition-colors duration-150 ease-out',
        'md:min-h-9 md:justify-start md:rounded-md md:px-2.5 md:text-left md:text-sm',
        active
          ? 'font-semibold text-ink md:bg-card md:shadow-[0_1px_2px_rgba(24,25,27,.08)] max-md:shadow-[inset_0_2px_0_var(--color-primary)]'
          : 'font-medium text-ink-soft hover:text-ink md:hover:bg-ink/5',
      ].join(' ')}
    >
      {children}
    </GuardedLink>
  );
}
