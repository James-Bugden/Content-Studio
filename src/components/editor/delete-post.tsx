'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MutationResult } from '@/domain/mutation';
import type { PostProperties } from '@/domain/post-versions';
import { newOperationId, postJson } from '@/lib/client/api';
import { useToast } from '../toaster';
import { invalidateEditor } from '../panel/editor-cache';

/** The server accepts a restore for 30 seconds after the delete time. */
export const RESTORE_WINDOW_MS = 30_000;

const trash = (
  <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" />
  </svg>
);
const spinner = <span aria-hidden="true" className="size-4 shrink-0 rounded-full border-2 border-current border-t-transparent motion-safe:animate-spin" />;

const shared = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-md border-2 border-block px-4 text-sm font-semibold transition-colors motion-safe:active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-50';
const outline = `${shared} bg-card text-block hover:bg-block hover:text-white active:bg-block active:text-white`;
const solid = `${shared} bg-block text-white hover:bg-block/90 active:bg-block/80`;
const quiet = 'inline-flex min-h-11 items-center justify-center rounded-md border-2 border-line bg-card px-4 text-sm font-semibold hover:border-ink disabled:opacity-50';

export function DeletePost({ libraryId, revision, disabled }: { libraryId: string; revision: string; disabled: boolean }) {
  const router = useRouter();
  const { notifyAction, notify } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const cancelRef = useRef<HTMLButtonElement>(null);
  const openRef = useRef<HTMLButtonElement>(null);
  const attempt = useRef<{ operationId: string; deletedAt: string; expectedRevision: string } | null>(null);

  useEffect(() => { if (confirming) cancelRef.current?.focus(); }, [confirming]);

  function cancel() {
    setConfirming(false); setError('');
    requestAnimationFrame(() => openRef.current?.focus());
  }

  async function remove() {
    setBusy(true); setError('');
    attempt.current ??= { operationId: newOperationId('delete'), deletedAt: new Date().toISOString(), expectedRevision: revision };
    const { deletedAt } = attempt.current;
    const response = await postJson<MutationResult<PostProperties>>(`/api/library/${encodeURIComponent(libraryId)}/lifecycle`, { ...attempt.current, action: 'delete' });
    setBusy(false);
    if (!response.body.ok) {
      const message = response.body.code === 'STALE_READ' ? 'This post changed. Reload it before deleting.' : 'The post could not be deleted. Try again.';
      if (response.body.code === 'STALE_READ') attempt.current = null;
      setError(message);
      notify(message, 'error');
      return;
    }
    const deletedRevision = response.body.value.revision;
    invalidateEditor(libraryId);
    const operationId = newOperationId('restore');
    notifyAction('Post deleted', { label: 'Undo', deadline: Date.parse(deletedAt) + RESTORE_WINDOW_MS, run: async () => {
      const restored = await postJson<MutationResult<PostProperties>>(`/api/library/${encodeURIComponent(libraryId)}/lifecycle`, { operationId, expectedRevision: deletedRevision, action: 'restore' });
      if (!restored.body.ok) throw new Error('restore');
      invalidateEditor(libraryId);
      window.dispatchEvent(new Event('cs:post-restored'));
      router.refresh();
      notify('Post restored.');
    } });
    const inPanel = new URLSearchParams(window.location.search).has('post');
    window.dispatchEvent(new CustomEvent('cs:post-deleted', { detail: libraryId }));
    if (!inPanel) router.replace('/review');
  }

  return (
    <div className="mt-4 flex flex-col gap-2 border-t border-line pt-4" data-delete-post>
      {confirming ? (
        <div role="group" aria-label="Confirm delete" className="flex flex-col gap-3 rounded-md border-2 border-block bg-block-soft p-3" onKeyDown={(e) => { if (e.key === 'Escape' && !busy) cancel(); }}>
          <p className="text-sm font-semibold">Delete this post? Scheduled copies and Typefully drafts are kept.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={solid} disabled={busy} aria-busy={busy} onClick={() => void remove()}>
              {busy ? <>{spinner}Deleting…</> : <>{trash}Delete</>}
            </button>
            <button ref={cancelRef} type="button" className={quiet} disabled={busy} onClick={cancel}>Cancel</button>
          </div>
        </div>
      ) : (
        <div>
          <button ref={openRef} type="button" className={outline} disabled={disabled} onClick={() => setConfirming(true)}>
            {trash}Delete post
          </button>
        </div>
      )}
      {disabled ? <p className="text-xs text-ink-soft">Save or undo changes before deleting.</p> : null}
      {error ? <p role="alert" className="text-sm font-semibold text-block">{error}</p> : null}
    </div>
  );
}
