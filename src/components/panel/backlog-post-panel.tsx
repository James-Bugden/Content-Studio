'use client';

import { useEffect, useState } from 'react';
import type { EditorModel } from '@/domain/views';
import { readableTitle } from '@/domain/display';
import { EditorWorkspace } from '../editor/editor-workspace';
import { StateView } from '../state-view';

type Load = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; model: EditorModel; canEdit: boolean; ns: string };

/** The Backlog goes straight to the guarded copy editor, avoiding the heavier
 * board, scheduling and promotion reads needed by the general post panel. */
export function BacklogPostPanel({ libraryId }: { libraryId: string }) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/library/${encodeURIComponent(libraryId)}/editor`, { credentials: 'same-origin', signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as { ok?: boolean; model?: EditorModel; canEdit?: boolean; ns?: string; message?: string };
        if (!response.ok || !body.ok || !body.model || typeof body.canEdit !== 'boolean' || !body.ns) throw new Error(body.message || 'The post could not be loaded.');
        setLoad({ kind: 'ready', model: body.model, canEdit: body.canEdit, ns: body.ns });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoad({ kind: 'error', message: error instanceof Error ? error.message : 'The post could not be loaded.' });
      });
    return () => controller.abort();
  }, [libraryId]);

  if (load.kind === 'loading') return <StateView kind="loading" title="Loading the editor" />;
  if (load.kind === 'error') return <StateView kind="provider_error" title="Could not open this post" detail={load.message} />;
  return <div className="flex flex-col gap-4">
    <header>
      <h2 id="panel-title" className="text-lg font-semibold">{readableTitle(load.model.slug) || load.model.sheet.hook || load.model.libraryId}</h2>
      <p className="text-sm text-ink-soft">{load.model.source} · {load.model.targetPlatform} · Review: {load.model.reviewStatus}</p>
    </header>
    <EditorWorkspace model={load.model} canEdit={load.canEdit} ns={load.ns} />
  </div>;
}
