'use client';

import { useEffect, useState } from 'react';
import { readableTitle } from '@/domain/display';
import { EditorWorkspace } from '../editor/editor-workspace';
import { StateView } from '../state-view';
import { buttonClass } from '../button-styles';
import { fetchEditor, prefetchEditor, takePrefetchedEditor, type EditorLoad } from './editor-cache';

type Load = { kind: 'loading' } | { kind: 'error'; message: string; rateLimited: boolean } | ({ kind: 'ready' } & EditorLoad);

/**
 * The Backlog goes straight to the guarded copy editor, avoiding the heavier
 * board, scheduling and promotion reads needed by the general post panel.
 * For bulk passes (CS-047) it uses a prefetched load when one is waiting, puts
 * the cursor in the copy, and once open starts loading the next post on the
 * current results page so Next is instant (restored in CS-053). A failed load
 * offers Try again in place (CS-051), so a brief Sheets slow-down costs one click.
 */
export function BacklogPostPanel({ libraryId, nextId, position, onSaved, onSaveFailed }: {
  libraryId: string;
  /** The following post on the current results page, prefetched once this one is open. */
  nextId?: string | null;
  /** "12 of 340" style position in the current results, when known. */
  position?: string;
  onSaved?: () => void;
  onSaveFailed?: () => void;
}) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    // A Try again never reuses a prefetch: it must be a fresh request.
    ((attempt === 0 ? takePrefetchedEditor(libraryId) : null) ?? fetchEditor(libraryId, controller.signal))
      .then((ready) => { if (!controller.signal.aborted) setLoad({ kind: 'ready', ...ready }); })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const code = error && typeof error === 'object' && 'code' in error ? (error as { code?: string }).code : undefined;
        setLoad({ kind: 'error', message: error instanceof Error ? error.message : 'The post could not be loaded.', rateLimited: code === 'RATE_LIMITED' });
      });
    return () => controller.abort();
  }, [libraryId, attempt]);

  const ready = load.kind === 'ready';
  useEffect(() => {
    if (ready && nextId) prefetchEditor(nextId);
  }, [ready, nextId]);

  if (load.kind === 'loading') return <StateView kind="loading" title="Loading the editor" />;
  if (load.kind === 'error') {
    return (
      <StateView
        kind={load.rateLimited ? 'rate_limited' : 'provider_error'}
        title="Could not open this post"
        detail={load.message}
        action={<button type="button" className={buttonClass('secondary', 'sm')} onClick={() => { setLoad({ kind: 'loading' }); setAttempt((n) => n + 1); }}>Try again</button>}
      />
    );
  }
  return <div className="flex flex-col gap-4">
    <header>
      <h2 id="panel-title" className="text-lg font-semibold">{readableTitle(load.model.slug) || load.model.sheet.hook || load.model.libraryId}</h2>
      <p className="text-sm text-ink-soft">{position ? <span className="tabular-nums">{position} · </span> : null}{load.model.source} · {load.model.targetPlatform} · Review: {load.model.reviewStatus}</p>
    </header>
    <EditorWorkspace model={load.model} canEdit={load.canEdit} ns={load.ns} focusMode reviewActions onSaved={onSaved} onSaveFailed={onSaveFailed} onReviewed={onSaved} />
  </div>;
}
