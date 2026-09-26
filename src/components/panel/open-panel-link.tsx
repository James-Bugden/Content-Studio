'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/**
 * Opens the side panel for a post (`?post=<Library ID>`), a schedule slot
 * (`?slot=<Content ID>`) or a backlog idea (`?queue=<Library ID>`) on the
 * current page, without navigating away. The URL carries ids only, never copy
 * (SEC-10), so a panel can be linked and reloaded.
 */
export function panelHref(pathname: string, params: URLSearchParams, target: { post: string } | { slot: string } | { queue: string }): string {
  const next = new URLSearchParams(params.toString());
  next.delete('post');
  next.delete('slot');
  next.delete('queue');
  if ('post' in target) next.set('post', target.post);
  else if ('slot' in target) next.set('slot', target.slot);
  else next.set('queue', target.queue);
  return `${pathname}?${next.toString()}`;
}

export function OpenPanelLink({
  target,
  className,
  children,
  label,
}: {
  target: { post: string } | { slot: string } | { queue: string };
  className?: string;
  children: React.ReactNode;
  /** Accessible name when children are not text. */
  label?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const href = panelHref(pathname, params, target);
  return (
    <a
      href={href}
      className={className}
      aria-label={label}
      aria-haspopup="dialog"
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        // Backlog posts already load through the editor API. A client-side URL
        // update avoids an unrelated server route refresh racing private search.
        if (pathname === '/backlog' && 'post' in target) window.history.replaceState(null, '', href);
        else router.replace(href, { scroll: false });
      }}
    >
      {children}
    </a>
  );
}
