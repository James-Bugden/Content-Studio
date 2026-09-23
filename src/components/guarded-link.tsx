'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { isAnyDirty } from './dirty-store';
import { useLeaveConfirmation } from './leave-confirm';

/**
 * In-app link that never silently discards a dirty editor (UX-04).
 *
 * Clean: behaves exactly like next/link, including modifier-click to a new tab.
 * Dirty: the click is held and an explicit dialog asks first. Only internal paths
 * are accepted; external sources use SourceLink.
 */
export type GuardedLinkProps = Omit<React.ComponentProps<typeof Link>, 'href' | 'onClick'> & {
  href: string;
  children: React.ReactNode;
};

export function GuardedLink({ href, children, ...rest }: GuardedLinkProps) {
  const router = useRouter();
  const { guard, dialog } = useLeaveConfirmation();

  return (
    <>
      <Link
        href={href}
        {...rest}
        onClick={(event) => {
          // New-tab and download clicks leave this tab's editor untouched.
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
          if (!isAnyDirty()) return;
          event.preventDefault();
          guard(() => router.push(href));
        }}
      >
        {children}
      </Link>
      {dialog}
    </>
  );
}
