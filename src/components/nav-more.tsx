'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { NavLink } from './nav-link';

/**
 * Phone-only "More" cell for the bottom tab bar (CS-046). The tab bar shows the
 * four daily destinations; the rest live behind this disclosure instead of
 * scrolling off the edge of the screen, where they were easy to miss. On wide
 * screens it is hidden and the sidebar lists every item directly.
 *
 * A native <details> keeps it keyboard and screen-reader operable without
 * extra ARIA. It closes after navigation and on Escape.
 */
export function NavMore({ items }: { items: readonly { href: string; label: string }[] }) {
  const pathname = usePathname() ?? '';
  const ref = useRef<HTMLDetailsElement>(null);
  const active = items.some((i) => pathname === i.href || pathname.startsWith(`${i.href}/`));

  useEffect(() => {
    if (ref.current) ref.current.open = false;
  }, [pathname]);

  return (
    <details
      ref={ref}
      className="group relative h-full"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && ref.current?.open) {
          ref.current.open = false;
          ref.current.querySelector('summary')?.focus();
        }
      }}
    >
      <summary
        className={`flex min-h-14 cursor-pointer list-none items-center justify-center px-2 text-xs whitespace-nowrap marker:hidden [&::-webkit-details-marker]:hidden ${
          active ? 'font-semibold text-ink shadow-[inset_0_2px_0_var(--color-primary)]' : 'font-medium text-ink-soft'
        }`}
      >
        More
      </summary>
      <ul className="absolute right-2 bottom-full mb-2 flex w-44 flex-col gap-0.5 rounded-lg border border-line bg-card p-1 shadow-[0_8px_24px_rgba(24,25,27,.12)]">
        {items.map((item) => (
          <li key={item.href} className="[&>a]:min-h-11 [&>a]:justify-start [&>a]:rounded-md [&>a]:px-3 [&>a]:text-sm">
            <NavLink href={item.href}>{item.label}</NavLink>
          </li>
        ))}
      </ul>
    </details>
  );
}
