'use client';

import { usePathname } from 'next/navigation';
import { GuardedLink } from './guarded-link';

/**
 * Primary navigation item (CS-006, UX-01, UX-04).
 *
 * The active item carries aria-current="page" and the black primary marker,
 * so the current place is never signalled by colour alone (it is also bold and
 * underlined). Navigation goes through GuardedLink so a dirty editor is never lost.
 */
export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname() ?? '';
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <GuardedLink
      href={href}
      prefetch={false}
      aria-current={active ? 'page' : undefined}
      className={[
        'inline-flex min-h-11 items-center rounded-md px-3 text-sm whitespace-nowrap transition-colors duration-150 ease-out',
        active
          ? 'bg-primary font-semibold text-white underline decoration-2 underline-offset-4 shadow-[0_1px_2px_rgba(23,32,35,.08)]'
          : 'text-ink-soft hover:bg-ink/5 hover:text-ink',
      ].join(' ')}
    >
      {children}
    </GuardedLink>
  );
}
