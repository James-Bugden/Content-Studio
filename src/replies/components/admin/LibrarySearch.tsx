'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { Button, Card, Meta, Pill, ReplyText, SectionHeading, StatusLine, cx } from '@/replies/components/replies/primitives';
import { LIBRARY } from '@/replies/lib/workspace/copy';
import { PLATFORM_LABELS, provenanceSchema, type Platform, type Provenance } from '@/replies/lib/contracts/vocabulary';
import type { PastReply } from '@/replies/lib/contracts/api';
import { adminApi } from './adminApi';
import { ApiError } from '@/replies/lib/workspace/client';

/**
 * The library page's interactive half (D05, D14, SEC-05).
 *
 * Search is POST-based on purpose: `query` travels in a request body, never in
 * `page.url()`, a query string, browser history or a referrer header. The filters
 * below it are additive constraints applied server-side by the same call, not a
 * client-side re-filter of a fixed page of results.
 *
 * "Use in reply" is a plain link to `/`, carrying only an opaque reply id, never the
 * reply text itself. The workspace page holds its own session state and this page
 * has no way to reach into it, so the hand-off is deliberately a link and not a
 * function call: the owner arrives at a fresh or existing workspace and decides for
 * themselves whether to paste the seed in, and nothing here can overwrite a draft
 * already in progress there (D14).
 */

const PLATFORMS: Platform[] = ['linkedin', 'x', 'threads'];
const PROVENANCES: Provenance[] = provenanceSchema.options;

function dateLabel(reply: PastReply): string {
  if (reply.date_precision === 'timestamp' && reply.posted_at) {
    return new Date(reply.posted_at).toISOString().slice(0, 10);
  }
  if (reply.date_precision === 'date_only' && reply.posted_date) {
    return reply.posted_date;
  }
  return LIBRARY.dateUnknown;
}

interface RowState {
  expanded: boolean;
  correcting: boolean;
  correctText: string;
  correctReason: string;
  confirmingWithdraw: boolean;
  revision: number;
  error: string | null;
  copyLabel: string;
}

function newRowState(reply: PastReply): RowState {
  return {
    expanded: false,
    correcting: false,
    correctText: reply.full_text,
    correctReason: '',
    confirmingWithdraw: false,
    // Every reply starts at revision 0 in the store and this page has no endpoint
    // that returns a row's current revision on its own, so a fresh row's first
    // correction attempt uses that known starting value. A real conflict (for
    // example a second correction made from another tab) still surfaces as 409 and
    // is handled below without losing what was typed here.
    revision: 0,
    error: null,
    copyLabel: LIBRARY.copy,
  };
}

function Row({
  reply,
  row,
  onChange,
  onRemove,
  onStatus,
  onCorrected,
}: {
  reply: PastReply;
  row: RowState;
  onChange(next: Partial<RowState>): void;
  onRemove(): void;
  onStatus(message: string): void;
  onCorrected(text: string): void;
}) {
  const isChinese = /\p{Script=Han}/u.test(reply.full_text);
  const correctId = useId();
  const reasonId = useId();

  async function copy() {
    try {
      await navigator.clipboard.writeText(reply.full_text);
      onChange({ copyLabel: LIBRARY.copied });
    } catch {
      onChange({ copyLabel: LIBRARY.copy });
    }
  }

  async function saveCorrection() {
    onChange({ error: null });
    try {
      const result = await adminApi.correctReply(reply.id, row.revision, row.correctText, row.correctReason);
      onChange({ correcting: false, revision: result.revision, error: null });
      // The row's own `reply` prop is a snapshot from the last search response, and
      // nothing about `RowState` carries display text, so the corrected wording has
      // to be pushed back into the parent's list explicitly or the card would keep
      // showing what was true before the correction.
      onCorrected(row.correctText);
      onStatus(LIBRARY.correctSaved);
    } catch (error) {
      const message =
        error instanceof ApiError && error.envelope.code === 'version_conflict'
          ? LIBRARY.correctConflict
          : LIBRARY.correctFailed;
      // The typed correction stays in the form either way (D14, C07).
      onChange({ error: message });
    }
  }

  async function confirmWithdraw() {
    try {
      await adminApi.setWithdrawn(reply.id, true);
      onStatus(LIBRARY.withdrawSaved);
      onRemove();
    } catch {
      onChange({ confirmingWithdraw: false, error: LIBRARY.withdrawFailed });
    }
  }

  return (
    <Card as="li" className="mb-2">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <Meta>{PLATFORM_LABELS[reply.platform]}</Meta>
        <Meta>{dateLabel(reply)}</Meta>
        <Pill tone={reply.provenance === 'posted_confirmed' ? 'green' : 'neutral'}>
          {LIBRARY.provenanceLabel[reply.provenance]}
        </Pill>
      </div>

      <ReplyText text={row.expanded ? reply.full_text : reply.excerpt} chinese={isChinese} />

      <div className="mt-2 flex flex-wrap gap-2">
        {reply.full_text.length > reply.excerpt.length ? (
          <Button variant="quiet" onClick={() => onChange({ expanded: !row.expanded })}>
            {row.expanded ? LIBRARY.collapse : LIBRARY.expand}
          </Button>
        ) : null}
        <Button variant="quiet" onClick={copy}>
          {row.copyLabel}
        </Button>
        {/* A real link, not the Button primitive: this is navigation to another
            page, and it should behave like one (open in a new tab, show a URL on
            hover, work with the browser's own back button). */}
        <Link
          href={`/?seed=${reply.id}`}
          title={LIBRARY.useInReplyHint}
          className="inline-flex min-h-8 items-center justify-center rounded-md px-3 text-meta font-medium text-ink-soft hover:bg-paper-alt hover:text-ink"
        >
          {LIBRARY.useInReply}
        </Link>
        <Button
          variant="quiet"
          onClick={() => onChange({ correcting: !row.correcting, error: null })}
        >
          {LIBRARY.correct}
        </Button>
        <Button
          variant="quiet"
          onClick={() => onChange({ confirmingWithdraw: !row.confirmingWithdraw, error: null })}
        >
          {LIBRARY.withdraw}
        </Button>
      </div>

      {row.correcting ? (
        <div className="mt-3 border-t border-hairline pt-3">
          <SectionHeading>{LIBRARY.correctHeading}</SectionHeading>
          <label htmlFor={correctId} className="mb-1 block text-meta font-medium">
            {LIBRARY.correctLabel}
          </label>
          <textarea
            id={correctId}
            value={row.correctText}
            onChange={(event) => onChange({ correctText: event.target.value })}
            rows={4}
            className={cx(
              'w-full resize-y rounded-md border border-border-input bg-card p-3 text-reply',
              isChinese && 'sr-cjk',
            )}
            {...(isChinese ? { lang: 'zh-TW' } : {})}
          />
          <label htmlFor={reasonId} className="mb-1 mt-2 block text-meta font-medium">
            {LIBRARY.correctReason}
          </label>
          <input
            id={reasonId}
            type="text"
            value={row.correctReason}
            onChange={(event) => onChange({ correctReason: event.target.value })}
            className="w-full rounded-md border border-border-input bg-card px-3 py-2 text-meta"
          />
          {row.error ? <StatusLine tone="error">{row.error}</StatusLine> : null}
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="primary" onClick={saveCorrection}>
              {LIBRARY.correctSave}
            </Button>
            <Button variant="quiet" onClick={() => onChange({ correcting: false, error: null })}>
              {LIBRARY.correctCancel}
            </Button>
          </div>
        </div>
      ) : null}

      {row.confirmingWithdraw ? (
        <div className="mt-3 border-t border-hairline pt-3">
          <Meta>{LIBRARY.withdrawHint}</Meta>
          {row.error ? <StatusLine tone="error">{row.error}</StatusLine> : null}
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="primary" onClick={confirmWithdraw}>
              {LIBRARY.withdrawConfirm}
            </Button>
            <Button variant="quiet" onClick={() => onChange({ confirmingWithdraw: false })}>
              {LIBRARY.withdrawCancel}
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

export function LibrarySearch() {
  const [query, setQuery] = useState('');
  const [platforms, setPlatforms] = useState<Set<Platform>>(new Set());
  const [provenances, setProvenances] = useState<Set<Provenance>>(new Set());
  const [includeUnknownDates, setIncludeUnknownDates] = useState(true);

  const [state, setState] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const [items, setItems] = useState<PastReply[]>([]);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const requestId = useRef(0);

  const search = useCallback(
    async (cursor: string | null = null) => {
      const thisRequest = ++requestId.current;
      setState('loading');
      try {
        const result = await adminApi.librarySearch({
          query,
          ...(platforms.size > 0 ? { platforms: [...platforms] } : {}),
          ...(provenances.size > 0 ? { provenances: [...provenances] } : {}),
          include_unknown_dates: includeUnknownDates,
          cursor,
          limit: 10,
        });
        if (thisRequest !== requestId.current) return;
        setItems((current) => (cursor ? [...current, ...result.items] : result.items));
        setRows((current) => {
          const next = cursor ? { ...current } : {};
          for (const item of result.items) next[item.id] ??= newRowState(item);
          return next;
        });
        setNextCursor(result.next_cursor);
        setState(result.state);
      } catch {
        if (thisRequest !== requestId.current) return;
        setState('error');
      }
    },
    [query, platforms, provenances, includeUnknownDates],
  );

  // A natural-language search tool with nothing to show until the owner types is
  // not a library. Loading the current library on arrival gives them something to
  // filter rather than a blank page. The call is deferred a tick so the effect
  // body itself never calls setState synchronously.
  useEffect(() => {
    const timer = setTimeout(() => void search(null), 0);
    return () => clearTimeout(timer);
    // Intentionally runs once on mount: subsequent searches are explicit submissions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function togglePlatform(platform: Platform) {
    setPlatforms((current) => {
      const next = new Set(current);
      if (next.has(platform)) next.delete(platform);
      else next.add(platform);
      return next;
    });
  }

  function toggleProvenance(provenance: Provenance) {
    setProvenances((current) => {
      const next = new Set(current);
      if (next.has(provenance)) next.delete(provenance);
      else next.add(provenance);
      return next;
    });
  }

  return (
    <section aria-labelledby="library-heading">
      <SectionHeading id="library-heading">{LIBRARY.heading}</SectionHeading>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void search(null);
        }}
      >
        <label htmlFor="library-search" className="mb-1 block text-meta font-medium">
          {LIBRARY.searchLabel}
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id="library-search"
            type="text"
            value={query}
            placeholder={LIBRARY.searchPlaceholder}
            onChange={(event) => setQuery(event.target.value)}
            className="min-w-0 flex-1 rounded-md border border-border-input bg-card px-3 py-2 text-reply"
          />
          <Button type="submit" variant="primary" size="primary" disabled={state === 'loading'}>
            {state === 'loading' ? LIBRARY.searching : LIBRARY.search}
          </Button>
        </div>

        <fieldset className="mt-3">
          <legend className="mb-1 text-meta font-medium">{LIBRARY.filterPlatform}</legend>
          <div className="flex flex-wrap gap-3">
            {PLATFORMS.map((platform) => (
              <label key={platform} className="flex items-center gap-1 text-meta">
                <input
                  type="checkbox"
                  checked={platforms.has(platform)}
                  onChange={() => togglePlatform(platform)}
                />
                {PLATFORM_LABELS[platform]}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="mt-3">
          <legend className="mb-1 text-meta font-medium">{LIBRARY.filterProvenance}</legend>
          <div className="flex flex-wrap gap-3">
            {PROVENANCES.map((provenance) => (
              <label key={provenance} className="flex items-center gap-1 text-meta">
                <input
                  type="checkbox"
                  checked={provenances.has(provenance)}
                  onChange={() => toggleProvenance(provenance)}
                />
                {LIBRARY.provenanceLabel[provenance]}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="mt-3 flex items-center gap-1 text-meta">
          <input
            type="checkbox"
            checked={includeUnknownDates}
            onChange={(event) => setIncludeUnknownDates(event.target.checked)}
          />
          {LIBRARY.includeUnknownDates}
        </label>
      </form>

      {status ? <StatusLine>{status}</StatusLine> : null}

      <div className="mt-4">
        {state === 'error' ? (
          <div>
            <StatusLine tone="error">{LIBRARY.error}</StatusLine>
            <Button className="mt-2" onClick={() => search(null)}>
              {LIBRARY.retry}
            </Button>
          </div>
        ) : null}

        {state === 'empty' ? <StatusLine>{LIBRARY.empty}</StatusLine> : null}

        {state === 'ready' || (state === 'loading' && items.length > 0) ? (
          <>
            <ul className="list-none p-0">
              {items.map((item) => {
                const row = rows[item.id] ?? newRowState(item);
                return (
                  <Row
                    key={item.id}
                    reply={item}
                    row={row}
                    onChange={(next) => setRows((current) => ({ ...current, [item.id]: { ...row, ...next } }))}
                    onRemove={() => {
                      setItems((current) => current.filter((r) => r.id !== item.id));
                      setRows((current) => {
                        const { [item.id]: _removed, ...rest } = current;
                        return rest;
                      });
                    }}
                    onStatus={setStatus}
                    onCorrected={(text) => {
                      const collapsed = text.replace(/\s+/g, ' ').trim();
                      const excerpt = collapsed.length > 160 ? `${collapsed.slice(0, 160)}...` : collapsed;
                      setItems((current) =>
                        current.map((r) => (r.id === item.id ? { ...r, full_text: text, excerpt } : r)),
                      );
                    }}
                  />
                );
              })}
            </ul>
            {nextCursor ? (
              <Button onClick={() => search(nextCursor)} disabled={state === 'loading'}>
                {LIBRARY.more}
              </Button>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}

