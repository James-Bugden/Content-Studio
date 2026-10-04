'use client';

import { useEffect, useState } from 'react';
import type { BacklogTotals } from '@/domain/library-backlog';
import { useBacklogNavigation } from './backlog-navigation';

/**
 * Progress at a glance above the Backlog table (CS-059): approved posts, those
 * queued for scheduling, and the Library total. Always the whole Library, not the
 * filtered view. It starts from the numbers the page rendered and re-reads them
 * whenever a post is saved or reviewed, so an approval shows up straight away
 * instead of waiting for a page reload.
 */
function Stat({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-xs text-ink-soft">{label}</dt>
      <dd className="flex flex-wrap items-baseline gap-x-1.5">
        <span className="text-2xl font-semibold tabular-nums text-ink">{value.toLocaleString('en-GB')}</span>
        {note ? <span className="text-xs text-ink-soft">{note}</span> : null}
      </dd>
    </div>
  );
}

const share = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '0%');

export function BacklogTotalsStrip({ initial }: { initial: BacklogTotals }) {
  const { totalsVersion } = useBacklogNavigation();
  const [fetched, setFetched] = useState<BacklogTotals | null>(null);

  useEffect(() => {
    if (totalsVersion === 0) return;
    const controller = new AbortController();
    fetch('/api/backlog/totals', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { ok?: boolean; totals?: BacklogTotals } | null) => {
        if (body?.ok && body.totals) setFetched(body.totals);
      })
      // A failed re-read keeps showing the last numbers; the next save tries again.
      .catch(() => {});
    return () => controller.abort();
  }, [totalsVersion]);

  const { total, approved, queued } = fetched ?? initial;
  return (
    <section aria-label="Content totals" className="mb-4 rounded-lg border border-line bg-card px-4 py-3">
      <dl className="grid grid-cols-3 gap-4">
        <Stat label="Approved" value={approved} note={`${share(approved, total)} of all`} />
        <Stat label="Queued for scheduling" value={queued} note={approved > 0 ? `${share(queued, approved)} of approved` : undefined} />
        <Stat label="Total posts" value={total} />
      </dl>
    </section>
  );
}
