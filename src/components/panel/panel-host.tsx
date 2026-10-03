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
import { isTypingTarget } from '../keyboard';
import { buttonClass } from '../button-styles';
import { LIBRARY_BACKLOG_PAGE_SIZE } from '@/domain/library-backlog';

/**
 * Side-panel host (UX redesign). Mounted once in the studio layout. When the URL
 * carries `?post=<Library ID>`, `?slot=<Content ID>` or `?queue=<Library ID>`, a
 * panel slides in from the right (full screen on a phone) so a post, a
 * schedule slot or a backlog idea can be read, edited and (for a post or slot)
 * approved and scheduled without leaving the page. Native <dialog>: focus is
 * trapped, Escape closes, and unsaved edits are guarded before closing.
 */
export function PanelHost() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const ref = useRef<HTMLDialogElement>(null);
  const navigationEpoch = useRef(0);
  const { navigation, setSearch, setSearchPage, setResult } = useBacklogNavigation();
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
  const open = Boolean(post || slot || queue);

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
   * The move waits two frames so the editor's saved state reaches the dirty
   * guard first; if something was typed during the save, the guard still asks.
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
    if (advanceAfterSave.current !== post) return;
    advanceAfterSave.current = null;
    if (hasNext) requestAnimationFrame(() => requestAnimationFrame(() => moveTo(1)));
  }

  function onDraftSaveFailed() {
    advanceAfterSave.current = null;
  }

  /**
   * Review shortcuts (CS-043, CS-047). Cmd/Ctrl+S saves the open draft from anywhere in
   * the panel; J/K and the arrow keys follow the Backlog's current sort and
   * filters through the same guarded Previous/Next, but never while typing.
   * Escape is the dialog's own cancel, which already runs the guarded close.
   * Cmd/Ctrl+Enter is Save and next, and Alt+↓/↑ move posts, both of which also
   * work from inside the copy so a bulk pass never needs the mouse.
   */
  function onPanelKeyDown(event: React.KeyboardEvent<HTMLDialogElement>) {
    const target = event.target instanceof Element ? event.target : null;
    if (target && target.closest('dialog') !== ref.current) return;
    if (post && pathname === '/backlog' && (event.metaKey || event.ctrlKey) && !event.altKey && event.key === 'Enter') {
      event.preventDefault();
      saveAndNext();
      return;
    }
    if (post && pathname === '/backlog' && event.altKey && !event.metaKey && !event.ctrlKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      if (direction === 1 ? hasNext : hasPrevious) moveTo(direction);
      return;
    }
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 's') {
      event.preventDefault();
      const save = ref.current?.querySelector<HTMLButtonElement>('button[data-shortcut="save-draft"]');
      if (save && !save.disabled) save.click();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
    if (!post || pathname !== '/backlog') return;
    const direction = event.key === 'j' || event.key === 'J' || event.key === 'ArrowDown' ? 1 : event.key === 'k' || event.key === 'K' || event.key === 'ArrowUp' ? -1 : 0;
    if (!direction) return;
    event.preventDefault();
    if (direction === 1 ? hasNext : hasPrevious) moveTo(direction);
  }

  return (
    <>
      <dialog
        ref={ref}
        onKeyDown={onPanelKeyDown}
        aria-labelledby="panel-title"
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
        className="m-0 ml-auto h-dvh max-h-none w-full max-w-none bg-paper p-0 text-ink backdrop:bg-ink/40 sm:w-[min(44rem,100vw)]"
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
            {moving ? <p role="status" className="px-4 py-2 text-sm">Loading adjacent post…</p> : null}
            {navigationError ? <p role="alert" className="px-4 py-2 text-sm text-block">{navigationError} <button type="button" className="font-semibold underline" onClick={() => moveTo(failedDirection)}>Try again</button></p> : null}
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              {post && pathname === '/backlog' ? <BacklogPostPanel key={post} libraryId={post} position={position} onSaved={onDraftSaved} onSaveFailed={onDraftSaveFailed} /> : null}
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
