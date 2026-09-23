'use client';

import { useCallback, useEffect, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { contentIdSchema, libraryIdSchema } from '@/domain/mutation';
import { useLeaveConfirmation } from '../leave-confirm';
import { PostPanel } from './post-panel';
import { SlotPanel } from './slot-panel';

/**
 * Side-panel host (UX redesign). Mounted once in the studio layout. When the URL
 * carries `?post=<Library ID>` or `?slot=<Content ID>`, a panel slides in from
 * the right (full screen on a phone) so a post can be read, edited, approved
 * and scheduled without leaving the page. Native <dialog>: focus is trapped,
 * Escape closes, and unsaved edits are guarded before closing.
 */
export function PanelHost() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const ref = useRef<HTMLDialogElement>(null);
  const { guard, dialog } = useLeaveConfirmation();

  // The promote page already uses `?slot=` to pick a target slot, so the panel stays shut there.
  const ownsSlotParam = /^\/ready\/[^/]+\/promote$/.test(pathname);
  const postParam = params.get('post');
  const slotParam = params.get('slot');
  const post = postParam && libraryIdSchema.safeParse(postParam).success ? postParam : null;
  const slot = !post && !ownsSlotParam && slotParam && contentIdSchema.safeParse(slotParam).success ? slotParam : null;
  const open = Boolean(post || slot);

  const close = useCallback(() => {
    guard(() => {
      const next = new URLSearchParams(params.toString());
      next.delete('post');
      next.delete('slot');
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
            <div className="flex items-center justify-between gap-2 border-b border-line bg-card px-4 py-2">
              <p className="text-xs font-semibold tracking-wide text-ink-soft">{post ? 'Post' : 'Schedule slot'}</p>
              <button type="button" onClick={close} className="inline-flex min-h-11 items-center gap-1 rounded-md px-3 text-sm hover:bg-paper">
                <span aria-hidden="true">✕</span> Close
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              {post ? <PostPanel key={post} libraryId={post} /> : null}
              {slot ? <SlotPanel key={slot} contentId={slot} /> : null}
            </div>
          </div>
        ) : null}
      </dialog>
      {dialog}
    </>
  );
}
