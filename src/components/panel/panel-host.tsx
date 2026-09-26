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
  const search = params.toString();
  const router = useRouter();
  const pathname = usePathname();
  const ref = useRef<HTMLDialogElement>(null);
  const [neighbours, setNeighbours] = useState<{ prev: string | null; next: string | null }>({ prev: null, next: null });
  const { guard, dialog } = useLeaveConfirmation();

  // The promote page already uses `?slot=` to pick a target slot, so the panel stays shut there.
  const ownsSlotParam = /^\/ready\/[^/]+\/promote$/.test(pathname);
  const postParam = params.get('post');
  const slotParam = params.get('slot');
  const queueParam = params.get('queue');
  const post = postParam && libraryIdSchema.safeParse(postParam).success ? postParam : null;
  const slot = !post && !ownsSlotParam && slotParam && contentIdSchema.safeParse(slotParam).success ? slotParam : null;
  const queue = !post && !slot && queueParam && libraryIdSchema.safeParse(queueParam).success ? queueParam : null;
  const open = Boolean(post || slot || queue);

  const close = useCallback(() => {
    guard(() => {
      const next = new URLSearchParams(params.toString());
      next.delete('post');
      next.delete('slot');
      next.delete('queue');
      const q = next.toString();
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
      router.refresh();
    });
  }, [guard, params, pathname, router]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  useEffect(() => {
    if (pathname !== '/backlog' || !post) return;
    const ids = [...document.querySelectorAll<HTMLElement>('[data-backlog-id]')].filter((el) => el.getClientRects().length > 0).map((el) => el.dataset.backlogId!).filter(Boolean);
    const index = ids.indexOf(post);
    queueMicrotask(() => setNeighbours({ prev: index > 0 ? ids[index - 1]! : null, next: index >= 0 && index < ids.length - 1 ? ids[index + 1]! : null }));
  }, [pathname, post, search]);

  function moveTo(id: string) {
    guard(() => router.replace(panelHref(pathname, new URLSearchParams(params.toString()), { post: id }), { scroll: false }));
  }

  return (
    <>
      <dialog
        ref={ref}
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
                <button type="button" disabled={!neighbours.prev} onClick={() => neighbours.prev && moveTo(neighbours.prev)} className="min-h-11 rounded border border-line px-2 disabled:opacity-40">Previous</button>
                <button type="button" disabled={!neighbours.next} onClick={() => neighbours.next && moveTo(neighbours.next)} className="min-h-11 rounded border border-line px-2 disabled:opacity-40">Next</button>
              </nav> : null}
              <button type="button" onClick={close} className="inline-flex min-h-11 items-center gap-1 rounded-md px-3 text-sm hover:bg-paper">
                <span aria-hidden="true">✕</span> Close
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              {post && pathname === '/backlog' ? <BacklogPostPanel key={post} libraryId={post} /> : null}
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
