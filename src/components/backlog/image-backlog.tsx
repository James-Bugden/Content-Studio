'use client';
import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { runImageBatch, type ImageOutcome, type ImageState } from '@/domain/image-pipeline';
import { newOperationId, postJson } from '@/lib/client/api';
import { LibraryBacklogTable } from './library-backlog-table';
import { ImageSelectionBar } from './image-selection-bar';
import type { ComponentProps } from 'react';
import { invalidateEditor } from '../panel/editor-cache';

export function ImageBacklog(props: ComponentProps<typeof LibraryBacklogTable>) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const operations = useRef(new Map<string, string>());
  const [progress, setProgress] = useState<Record<string, string>>({});
  const [known, setKnown] = useState<Record<string, { image: ImageState; baseRevision?: string }>>({});
  const [summary, setSummary] = useState('');
  const ids = props.rows.map(r => r.value.libraryId);
  const active = ids.filter(id => selected.has(id));
  async function run(action: 'check' | 'create') {
    if (running.current || active.length > 25) return;
    running.current = true;
    setBusy(true); setSummary(''); setProgress({});
    try {
      const items = props.rows.filter(r => selected.has(r.value.libraryId)).map(r => {
        const previous = known[r.value.libraryId];
        return { libraryId: r.value.libraryId, expectedRevision: previous && previous.baseRevision === r.revision ? previous.image.revision : r.revision, baseRevision: r.revision };
      });
      const total = await runImageBatch(items, async item => {
        const key = JSON.stringify([item.libraryId, item.expectedRevision, action]);
        const operationId = operations.current.get(key) ?? newOperationId('image');
        operations.current.set(key, operationId);
        const { body } = await postJson<ImageOutcome>('/api/images', { libraryId: item.libraryId, expectedRevision: item.expectedRevision, action, operationId });
        if (body.ok) { operations.current.delete(key); invalidateEditor(item.libraryId); }
        if (body.ok) setKnown(current => ({ ...current, [item.libraryId]: { image: body.image, baseRevision: item.baseRevision } }));
        return body;
      }, (id, state, result) => setProgress(current => ({ ...current, [id]: state === 'running' ? (action === 'check' ? 'Checking images...' : 'Creating image...') : result?.ok ? (action === 'check' ? result.image.sketch ? 'Needs image: ' : 'Text only: ' : 'Image created. ') + result.image.reason + (action === 'check' && result.image.options.length ? ` (${result.image.options.length} sketch ${result.image.options.length === 1 ? 'option' : 'options'})` : '') : result && !result.ok ? result.message : 'Could not finish. Try again.' })), result => result.ok);
      setSummary(`${total.succeeded} completed, ${total.failed} failed.`);
    } finally { running.current = false; setBusy(false); router.refresh(); }
  }
  return <div className="space-y-3">
    {props.canEdit && !props.readOnly ? <ImageSelectionBar count={active.length} all={ids.length > 0 && active.length === ids.length} busy={busy}
      onAll={checked => setSelected(new Set(checked ? ids : []))} onCheck={() => void run('check')} onCreate={() => void run('create')} /> : null}
    <p role="status" className="text-sm">{summary || (busy ? 'Working on selected posts...' : '')}</p>
    <LibraryBacklogTable {...props} imageProgress={progress} selection={props.canEdit && !props.readOnly ? {
      ids: selected, busy, toggle: id => setSelected(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }),
    } : undefined} />
  </div>;
}
