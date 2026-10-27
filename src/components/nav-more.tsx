'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { NavLink } from './nav-link';
import { ShellIcon } from './shell-icon';

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
        className="studio-more-toggle"
        data-active={active}
      >
        <ShellIcon name="more" /><span>More</span>
      </summary>
      <ul className="studio-more-menu">
        {items.map((item) => (
          <li key={item.href}>
            <NavLink href={item.href}>{item.label}</NavLink>
          </li>
        ))}
      </ul>
    </details>
  );
}
