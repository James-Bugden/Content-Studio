'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MutationResult } from '@/domain/mutation';
import type { PostProperties } from '@/domain/post-versions';
import { newOperationId, postJson } from '@/lib/client/api';
import { useToast } from '../toaster';
import { InlineResult } from '../inline-result';
import { invalidateEditor } from '../panel/editor-cache';

export function DeletePost({ libraryId, revision, disabled }: { libraryId: string; revision: string; disabled: boolean }) {
  const router = useRouter();
  const { notifyAction, notify } = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const attempt = useRef<{ operationId: string; deletedAt: string; expectedRevision: string } | null>(null);
  async function remove() {
    setBusy(true); setError('');
    attempt.current ??= { operationId: newOperationId('delete'), deletedAt: new Date().toISOString(), expectedRevision: revision };
    const response = await postJson<MutationResult<PostProperties>>(`/api/library/${encodeURIComponent(libraryId)}/lifecycle`, { ...attempt.current, action: 'delete' });
    setBusy(false);
    if (!response.body.ok) { setError(response.body.code === 'STALE_READ' ? 'This post changed. Reload it before deleting.' : 'The post could not be deleted. Try again.'); return; }
    const deletedRevision = response.body.value.revision;
    invalidateEditor(libraryId);
    const operationId = newOperationId('restore');
    notifyAction('Post deleted.', { label: 'Undo', durationMs: 12_000, run: async () => {
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
  return <div className="mt-3">
    <button type="button" disabled={disabled || busy} onClick={() => void remove()} className="inline-flex min-h-11 items-center gap-2 rounded-md px-2 text-sm text-block disabled:opacity-40"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" /></svg>{busy ? 'Deleting…' : 'Delete post'}</button>
    <p className="text-xs text-ink-soft">Scheduled copies and Typefully drafts are kept.</p>
    {disabled ? <p className="text-xs text-ink-soft">Save or undo changes before deleting.</p> : null}
    {error ? <InlineResult tone="error">{error}</InlineResult> : null}
  </div>;
}
