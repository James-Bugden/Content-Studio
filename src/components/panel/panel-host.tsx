'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { contentIdSchema, libraryIdSchema } from '@/domain/mutation';
import { useLeaveConfirmation } from '../leave-confirm';
import { PostPanel } from './post-panel';
import { QueuePanel } from './queue-panel';
import { panelHref } from './open-panel-link';
import { BacklogPostPanel } from './backlog-post-panel';
import { SlotPanel } from './slot-panel';
import { useBacklogNavigation } from '../backlog/backlog-navigation';
import { classifyShortcut, enabledButton, listPostIds, neighbour } from './shortcuts';
import { isTypingTarget } from '../keyboard';
import { buttonClass } from '../button-styles';
import { LIBRARY_BACKLOG_PAGE_SIZE } from '@/domain/library-backlog';
import { InlineResult } from '../inline-result';
import { StateView } from '../state-view';

/** Backlog owns its host so its server read decides whether a panel may mount. */
export function StudioPanelHost() {
  const pathname = usePathname();
  return pathname === '/backlog' ? null : <PanelHost />;
}

/**
 * Side-panel host (UX redesign). Backlog mounts it with the server's read-only
 * decision; other routes share the layout host. When the URL
 * carries `?post=<Library ID>`, `?slot=<Content ID>` or `?queue=<Library ID>`, a
 * panel slides in from the right (full screen on a phone) so a post, a
 * schedule slot or a backlog idea can be read, edited and (for a post or slot)
 * approved and scheduled without leaving the page. Native <dialog>: focus is
 * trapped, Escape closes, and unsaved edits are guarded before closing.
 */
export function PanelHost({ readOnly = false }: { readOnly?: boolean }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const ref = useRef<HTMLDialogElement>(null);
  const navigationEpoch = useRef(0);
  const { navigation, setSearch, setSearchPage, setResult, refreshTotals } = useBacklogNavigation();
  const [moving, setMoving] = useState(false);
  const [navigationError, setNavigationError] = useState('');
  const [failedDirection, setFailedDirection] = useState<-1 | 1>(1);
  const { guard, dialog } = useLeaveConfirmation();
  /** A Backlog draft was saved while the panel was open, so the table refreshes once on close (CS-047). */
  const rowsStale = useRef(false);
  /** The post whose in-flight save should be followed by moving to the next post. */
  const advanceAfterSave = useRef<string | null>(null);

  // The promote page already uses `?slot=` to pick a target slot, so the panel stays shut there.
  const ownsSlotParam = /^\/ready\/[^/]+\/promote$/.test(pathname);
  const postParam = params.get('post');
  const slotParam = params.get('slot');
  const queueParam = params.get('queue');
  const post = postParam && libraryIdSchema.safeParse(postParam).success ? postParam : null;
  const slot = !post && !ownsSlotParam && slotParam && contentIdSchema.safeParse(slotParam).success ? slotParam : null;
  const queue = !post && !slot && queueParam && libraryIdSchema.safeParse(queueParam).success ? queueParam : null;
  const open = Boolean(post || slot || queue) && !(pathname === '/backlog' && readOnly);

  useEffect(() => {
    const onDeleted = () => {
      navigationEpoch.current++;
      const next = new URLSearchParams(window.location.search);
      next.delete('post');
      window.history.replaceState(null, '', `${pathname}${next.size ? `?${next}` : ''}`);
      ref.current?.close();
      refreshTotals();
      router.refresh();
    };
    window.addEventListener('cs:post-deleted', onDeleted);
    window.addEventListener('cs:post-restored', refreshTotals);
    return () => { window.removeEventListener('cs:post-deleted', onDeleted); window.removeEventListener('cs:post-restored', refreshTotals); };
  }, [pathname, refreshTotals, router]);

  useEffect(() => {
    if (pathname === '/backlog' && params.get('view') !== 'ideas') return;
    setSearch('');
    setSearchPage(1);
    setResult(null);
  }, [pathname, params, setSearch, setSearchPage, setResult]);

  const close = useCallback(() => {
    guard(() => {
      navigationEpoch.current += 1;
      setNavigationError('');
      const next = new URLSearchParams(params.toString());
      next.delete('post');
      next.delete('slot');
      next.delete('queue');
      const q = next.toString();
      const href = q ? `${pathname}?${q}` : pathname;
      if (pathname === '/backlog' && post) {
        window.history.replaceState(null, '', href);
        // One refresh after a bulk pass instead of a full Sheet re-read after every save.
        if (rowsStale.current) {
          rowsStale.current = false;
          router.refresh();
        }
      } else {
        router.replace(href, { scroll: false });
        router.refresh();
      }
    });
  }, [guard, params, pathname, post, router]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  const index = navigation && post ? navigation.ids.indexOf(post) : -1;
  const hasPrevious = index > 0 || index === 0 && (navigation?.page ?? 1) > 1;
  const hasNext = index >= 0 && (index < (navigation?.ids.length ?? 0) - 1 || (navigation?.page ?? 1) < (navigation?.totalPages ?? 1));

  const position = navigation && post && index >= 0 ? `${(navigation.page - 1) * LIBRARY_BACKLOG_PAGE_SIZE + index + 1} of ${navigation.total}` : undefined;
  const nextOnPage = navigation && index >= 0 ? navigation.ids[index + 1] ?? null : null;

  function moveTo(direction: -1 | 1) {
    if (!navigation || !post || moving) return;
    guard(async () => {
      const epoch = navigationEpoch.current;
      setMoving(true);
      setNavigationError('');
      try {
        const target = await navigation.adjacent(post, direction);
        if (epoch !== navigationEpoch.current) return;
        const next = new URLSearchParams(params.toString());
        if (!navigation.privateSearch) next.set('page', String(target.page));
        window.history.replaceState(null, '', panelHref(pathname, next, { post: target.id }));
      } catch (error) {
        setFailedDirection(direction);
        setNavigationError(error instanceof Error ? error.message : 'The next post could not load. Try again.');
      } finally {
        setMoving(false);
      }
    });
  }

  /**
   * Save and next (CS-047): saves the open draft when it has changes, then moves
   * to the next post in the current sort and filters. With nothing to save it
   * just moves on. A failed save stays put with its error, so nothing is lost.
   * The editor reports success after its saved state reaches the dirty guard;
   * if something was typed during the save, the guard still asks.
   */
  function saveAndNext() {
    if (!post || moving) return;
    const save = ref.current?.querySelector<HTMLButtonElement>('button[data-shortcut="save-draft"]');
    if (save && !save.disabled) {
      advanceAfterSave.current = post;
      save.click();
      return;
    }
    if (hasNext) moveTo(1);
  }

  function onDraftSaved() {
    rowsStale.current = true;
    // Saved or reviewed: re-read the approved / queued totals now, not when the panel closes (CS-059).
    refreshTotals();
    if (advanceAfterSave.current !== post) return;
    advanceAfterSave.current = null;
    if (hasNext) moveTo(1);
  }

  function onDraftSaveFailed() {
    advanceAfterSave.current = null;
  }

  /** J/K on Next up and Review: follow the post links in page order (#247). */
  function moveInList(direction: -1 | 1): boolean {
    const target = post ? neighbour(listPostIds(), post, direction) : null;
    if (!target) return false;
    guard(() => router.replace(panelHref(pathname, params, { post: target }), { scroll: false }));
    return true;
  }

  /**
   * Review shortcuts (CS-043, CS-047, #247). Cmd/Ctrl+S saves the open draft from anywhere in
   * the panel; J/K and the arrow keys follow the Backlog's current sort and
   * filters through the same guarded Previous/Next (or the post links in page order on
   * Next up and Review), but never while typing.
   * Escape is the dialog's own cancel, which already runs the guarded close.
   * Cmd/Ctrl+Enter is Save and next, Cmd/Ctrl+Shift+Enter presses Approve and queue
   * only while that button is enabled, and Alt+↓/↑ move posts, all of which also
   * work from inside the copy so a bulk pass never needs the mouse.
   */
  function onPanelKeyDown(event: React.KeyboardEvent<HTMLDialogElement>) {
    const target = event.target instanceof Element ? event.target : null;
    if (target && target.closest('dialog') !== ref.current) return;
    const action = classifyShortcut(event, isTypingTarget(event.target));
    if (!action) return;
    const onBacklog = pathname === '/backlog';
    if (action === 'approve-and-queue') {
      if (!post) return;
      event.preventDefault();
      enabledButton(ref.current, 'button[data-shortcut="approve-and-queue"]')?.click();
      return;
    }
    if (action === 'save-and-next') {
      if (post && onBacklog) { event.preventDefault(); saveAndNext(); }
      return;
    }
    if (action === 'save-draft') {
      event.preventDefault();
      enabledButton(ref.current, 'button[data-shortcut="save-draft"]')?.click();
      return;
    }
    if (!post) return;
    const direction = action === 'next' ? 1 : -1;
    if (onBacklog) {
      event.preventDefault();
      if (direction === 1 ? hasNext : hasPrevious) moveTo(direction);
    } else if (moveInList(direction)) event.preventDefault();
  }

  return (
    <>
      <dialog
        ref={ref}
        onKeyDown={onPanelKeyDown}
        aria-labelledby="panel-title"
        aria-label={post ? 'Post' : slot ? 'Schedule slot' : 'Backlog idea'}
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
        className={`m-0 ml-auto h-dvh max-h-none w-full max-w-none bg-white p-0 text-ink backdrop:bg-ink/30 ${post ? 'sm:w-[min(70rem,calc(100vw-4rem))]' : 'sm:w-[min(44rem,100vw)]'}`}
      >
        {open ? (
          <div className="flex h-full flex-col">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-card px-4 py-2">
              <p className="text-xs font-semibold tracking-wide text-ink-soft">{post ? 'Post' : slot ? 'Schedule slot' : 'Backlog idea'}</p>
              {post && pathname === '/backlog' ? <nav aria-label="Move between posts" className="ml-auto flex gap-2 text-sm">
                <button type="button" aria-keyshortcuts="K ArrowUp" title="Previous post (K or ↑)" disabled={!hasPrevious || moving} onClick={() => moveTo(-1)} className="min-h-11 rounded border border-line px-2 disabled:opacity-40">Previous</button>
                <button type="button" aria-keyshortcuts="J ArrowDown" title="Next post (J or ↓)" disabled={!hasNext || moving} onClick={() => moveTo(1)} className="min-h-11 rounded border border-line px-2 disabled:opacity-40">Next</button>
                <button type="button" data-shortcut="save-and-next" aria-keyshortcuts="Control+Enter Meta+Enter" title={hasNext ? 'Save this draft if changed, then open the next post (Ctrl or Cmd + Enter)' : 'Save this draft (last post in these results)'} disabled={moving} onClick={saveAndNext} className={buttonClass('primary')}>
                  {hasNext ? 'Save & next' : 'Save'}
                </button>
              </nav> : null}
              <button type="button" onClick={close} className="inline-flex min-h-11 items-center gap-1 rounded-md px-3 text-sm hover:bg-paper">
                <span aria-hidden="true">✕</span> Close
              </button>
            </div>
            {moving ? <StateView kind="loading" title="Loading adjacent post…" /> : null}
            {navigationError ? <InlineResult tone="error">{navigationError} <button type="button" className="min-h-11 font-semibold underline" onClick={() => moveTo(failedDirection)}>Try again</button></InlineResult> : null}
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              {post && pathname === '/backlog' ? <BacklogPostPanel key={post} libraryId={post} nextId={nextOnPage} position={position} onSaved={onDraftSaved} onSaveFailed={onDraftSaveFailed} /> : null}
              {post && pathname !== '/backlog' ? <PostPanel key={post} libraryId={post} /> : null}
              {slot ? <SlotPanel key={slot} contentId={slot} /> : null}
              {queue ? <QueuePanel key={queue} libraryId={queue} /> : null}
            </div>
          </div>
        ) : null}
      </dialog>
      {dialog}
    </>
  );
}
