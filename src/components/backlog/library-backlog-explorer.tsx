'use client';

import { useEffect, useRef, useState } from 'react';
import type { LibraryRecord } from '@/domain/records';
import type { BacklogReadiness, LibraryBacklogFilters } from '@/domain/library-backlog';
import { LibraryBacklogTable } from './library-backlog-table';

type Result = {
  ok: true;
  rows: Pick<LibraryRecord, 'row' | 'value'>[];
  statuses: Record<string, BacklogReadiness>;
  total: number;
  page: number;
  totalPages: number;
};

type Props = {
  initial: Result;
  filters: Pick<LibraryBacklogFilters, 'source' | 'platform' | 'status' | 'sort'>;
  previousHref: string | null;
  nextHref: string | null;
};

/** Search is deliberately ephemeral: private post copy never goes in a URL. */
export function LibraryBacklogExplorer({ initial, filters, previousHref, nextHref }: Props) {
  const { source, platform, status, sort } = filters;
  const [search, setSearch] = useState('');
  const [searchPage, setSearchPage] = useState(1);
  const [result, setResult] = useState<{ key: string; data: Result } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [compact, setCompact] = useState(true);
  const [showHooks, setShowHooks] = useState(true);
  const filtersKey = JSON.stringify([source, platform, status, sort]);
  const previousFilters = useRef(filtersKey);
  const queryKey = JSON.stringify([search, searchPage, filtersKey]);

  useEffect(() => {
    if (previousFilters.current !== filtersKey) {
      previousFilters.current = filtersKey;
      setSearchPage(1);
      setResult(null);
    }
  }, [filtersKey]);

  useEffect(() => {
    if (!search.trim()) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setPending(true);
      setError(false);
      try {
        const response = await fetch('/api/backlog/search', {
          method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ search, page: searchPage, source, platform, status, sort }),
        });
        const body = await response.json() as Result;
        if (!response.ok || !body.ok) throw new Error('search_failed');
        setResult({ key: queryKey, data: body });
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (!controller.signal.aborted) setPending(false);
      }
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [search, searchPage, source, platform, status, sort, retry, queryKey]);

  const searched = search.trim() ? result?.key === queryKey ? result.data : null : null;
  const loading = Boolean(search.trim() && !searched && !error);
  const active = searched ?? initial;
  return <section aria-label="Browse Content Library" className="space-y-3">
    <div className="flex flex-wrap items-center gap-3">
      <label htmlFor="library-search" className="text-sm font-medium">Find a post</label>
      <input id="library-search" type="search" value={search} maxLength={120}
        onChange={(event) => { setSearch(event.target.value); setSearchPage(1); setResult(null); setPending(Boolean(event.target.value.trim())); setError(false); }}
        placeholder="Search title, hook, content or source" className="min-h-11 min-w-64 flex-1 rounded-md border border-line bg-card px-3 text-sm" />
    </div>
    <div className="flex flex-wrap items-center gap-4 text-sm">
      <label className="inline-flex min-h-11 items-center gap-2"><input type="checkbox" checked={compact} onChange={(e) => setCompact(e.target.checked)} /> Compact rows</label>
      <label className="inline-flex min-h-11 items-center gap-2"><input type="checkbox" checked={showHooks} onChange={(e) => setShowHooks(e.target.checked)} /> Show hook columns</label>
    </div>
    <p className="text-sm text-ink-soft" aria-live="polite">
      {pending || loading ? 'Searching…' : error ? 'Results unavailable.' : `${active.total} ${active.total === 1 ? 'post' : 'posts'} · page ${active.page} of ${active.totalPages}`}.
    </p>
    {error ? <p role="alert" className="text-sm text-block">Search could not load. Your search text is kept here. <button type="button" className="min-h-11 font-semibold underline" onClick={() => { setPending(true); setError(false); setRetry((n) => n + 1); }}>Try again</button></p> : null}
    {search.trim() && (pending || loading || error) ? null : active.total === 0 ? <p role="status" className="rounded-lg border border-line bg-card p-4 text-sm">No posts match. Try a different source, status or search.</p>
      : <LibraryBacklogTable rows={active.rows} statuses={active.statuses} compact={compact} showHooks={showHooks} />}
    {active.totalPages > 1 && !(search.trim() && (pending || loading || error)) ? <nav aria-label="Backlog pages" className="flex items-center justify-between text-sm">
      {search.trim() ? <button type="button" disabled={pending || active.page <= 1} onClick={() => { setPending(true); setSearchPage(active.page - 1); }} className="min-h-11 text-primary underline disabled:opacity-40">Previous page</button>
        : previousHref ? <a className="min-h-11 py-3 text-primary underline" href={previousHref}>Previous page</a> : <span />}
      <span>Page {active.page} / {active.totalPages}</span>
      {search.trim() ? <button type="button" disabled={pending || active.page >= active.totalPages} onClick={() => { setPending(true); setSearchPage(active.page + 1); }} className="min-h-11 text-primary underline disabled:opacity-40">Next page</button>
        : nextHref ? <a className="min-h-11 py-3 text-primary underline" href={nextHref}>Next page</a> : <span />}
    </nav> : null}
  </section>;
}
