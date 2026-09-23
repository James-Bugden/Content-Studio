'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/**
 * Opens the side panel for a post (`?post=<Library ID>`) or a schedule slot
 * (`?slot=<Content ID>`) on the current page, without navigating away. The URL
 * carries ids only, never copy (SEC-10), so a panel can be linked and reloaded.
 */
export function panelHref(pathname: string, params: URLSearchParams, target: { post: string } | { slot: string }): string {
  const next = new URLSearchParams(params.toString());
  next.delete('post');
  next.delete('slot');
  if ('post' in target) next.set('post', target.post);
  else next.set('slot', target.slot);
  return `${pathname}?${next.toString()}`;
}

export function OpenPanelLink({
  target,
  className,
  children,
  label,
}: {
  target: { post: string } | { slot: string };
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
        router.replace(href, { scroll: false });
      }}
    >
      {children}
    </a>
  );
}
