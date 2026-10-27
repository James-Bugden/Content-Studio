'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

type Counts = { nextUp: number | null; fixIssues: number | null };
const EMPTY: Counts = { nextUp: null, fixIssues: null };
const CountsContext = createContext<Counts>(EMPTY);

export function NavigationCountsProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [result, setResult] = useState<{ pathname: string | null; counts: Counts }>({ pathname: null, counts: EMPTY });
  useEffect(() => {
    const controller = new AbortController();
    let expiry: ReturnType<typeof setTimeout>;
    let retry: ReturnType<typeof setTimeout>;
    const setCounts = (counts: Counts) => setResult({ pathname, counts });
    const read = (attempt = 0) => void fetch('/api/navigation-counts', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('unavailable');
        const data = await response.json();
        if (controller.signal.aborted) return;
        const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
        const remaining = Math.max(0, Math.min(15_000, Number(data.expiresAt) - Date.now()) || 0);
        setCounts(remaining ? { nextUp: count(data.nextUp), fixIssues: count(data.fixIssues) } : EMPTY);
        clearTimeout(expiry);
        if (remaining) expiry = setTimeout(() => setCounts(EMPTY), remaining);
        // A streamed page can finish its existing reads after the shell mounts.
        // Retry only the current action page's missing total; these are cache-only.
        if (attempt < 2 && (pathname === '/' && count(data.nextUp) === null || pathname === '/reconcile' && count(data.fixIssues) === null)) {
          retry = setTimeout(() => read(attempt + 1), 500);
        }
      }).catch(() => { if (!controller.signal.aborted) setCounts(EMPTY); });
    read();
    return () => { controller.abort(); clearTimeout(expiry); clearTimeout(retry); };
  }, [pathname]);
  return <CountsContext value={result.pathname === pathname ? result.counts : EMPTY}>{children}</CountsContext>;
}

export function NavigationBadge({ href }: { href: string }) {
  const counts = useContext(CountsContext);
  const count = href === '/' ? counts.nextUp : href === '/reconcile' ? counts.fixIssues : null;
  return count === null ? null : (
    <span data-nav-count={href} className="studio-nav-badge sr-tnum">
      {count > 999 ? '999+' : count}
    </span>
  );
}
