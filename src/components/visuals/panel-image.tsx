'use client';

import { useRef, useState, useSyncExternalStore } from 'react';
import type { VisualItemView } from '@/domain/visual-studio';
import { newOperationId, postJson } from '@/lib/client/api';
import { buttonClass } from '../button-styles';
import { InlineResult } from '../inline-result';
import { GuardedLink } from '../guarded-link';
import { VisualEditor } from './visual-editor';
import { useDirtyGuard } from '../use-dirty-guard';
import { isAnyDirty, serverSnapshot, subscribeDirty } from '../dirty-store';

export function PanelImage({ initial, imageBrief, canEdit, copyDirty, onChanged }: {
  initial: VisualItemView; imageBrief?: string; canEdit: boolean; copyDirty: boolean; onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [editorMounted, setEditorMounted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const initialReason = initial.reason || initial.brief?.lesson || '';
  const [reason, setReason] = useState(initialReason);
  const reasonDirty = reason !== initialReason;
  useDirtyGuard(reasonDirty);
  const anyDirty = useSyncExternalStore(subscribeDirty, isAnyDirty, serverSnapshot);
  const briefDirty = anyDirty && !copyDirty && !reasonDirty;
  const pending = useRef<{ key: string; id: string } | null>(null);
  const advanced = useRef<HTMLDetailsElement>(null);
  const noImage = initial.decision === 'text_only';
  const undecided = ['undecided', 'invalid'].includes(initial.decision);
  const disabled = busy || anyDirty || !canEdit;

  async function run(payload: Record<string, unknown>) {
    const key = JSON.stringify([initial.revision, payload]);
    const operationId = pending.current?.key === key ? pending.current.id : newOperationId('visual');
    pending.current = { key, id: operationId };
    setBusy(true); setError('');
    const { body } = await postJson<{ ok: boolean; message?: string }>(`/api/library/${encodeURIComponent(initial.libraryId)}/visual`, {
      ...payload, libraryId: initial.libraryId, operationId, expectedRevision: initial.revision,
    });
    setBusy(false);
    if (body.ok) { pending.current = null; onChanged(); }
    else setError(body.message || 'Image change failed. Reload and try again.');
  }

  function editBrief() {
    setEditorMounted(true);
    setOpen(true);
    requestAnimationFrame(() => advanced.current?.scrollIntoView({ block: 'nearest' }));
  }

  return <section id="panel-image" aria-labelledby="panel-image-heading" className="min-w-0 space-y-3 rounded-lg border border-line bg-card p-3">
    <h3 id="panel-image-heading" className="font-semibold">Image</h3>
    <p><strong>{undecided ? 'Image decision needed' : noImage ? 'No image needed' : 'Needs an image'}</strong></p>
    <p className="text-sm">{initialReason || 'Reason not recorded.'}</p>
    {canEdit ? <div className="space-y-2">
      <label className="block text-sm">Image reason<input aria-label="Image reason" disabled={busy || copyDirty || briefDirty} maxLength={300} value={reason} onChange={e => setReason(e.target.value)} className="mt-1 min-h-11 w-full rounded-md border border-line bg-card px-3 text-base" /></label>
      {reasonDirty ? <button type="button" className={buttonClass()} disabled={busy || copyDirty || !reason.trim()} onClick={() => void run({ action: 'reason', reason: reason.trim() })}>Save image reason</button> : null}
    </div> : null}
    <p className="text-sm">Status: {initial.imageStatus} · {initial.decisionLabel}</p>
    <p className="whitespace-pre-wrap break-words text-sm"><strong>Brief: </strong>{initial.brief?.lineBrokenCopy || (initial.briefUnreadable ? imageBrief : '') || 'No brief yet.'}</p>
    {canEdit ? <div className="flex flex-wrap gap-2">
      {initial.decision !== 'original_graphic' ? <button type="button" disabled={disabled} className={buttonClass('primary')} onClick={() => void run({ action: 'decide', decision: 'original_graphic' })}>Needs an image</button>
        : <button type="button" disabled={disabled} className={buttonClass('primary')} onClick={() => initial.canRender.ok ? void run({ action: 'render' }) : editBrief()}>{initial.canRender.ok ? 'Generate image' : 'Complete image brief'}</button>}
      <button type="button" disabled={disabled} className={buttonClass()} onClick={editBrief}>Attach screenshot</button>
      <button type="button" disabled={disabled || noImage} className={buttonClass()} onClick={() => void run({ action: 'decide', decision: 'text_only' })}>Mark no image</button>
      <button type="button" disabled={disabled} className={buttonClass()} onClick={editBrief}>Edit image brief</button>
    </div> : null}
    {copyDirty ? <p className="text-base">Save the draft before changing its image.</p> : null}
    {briefDirty ? <p className="text-base">Save the image brief before changing its decision. <button type="button" className="underline" onClick={editBrief}>Continue editing</button></p> : null}
    {error ? <InlineResult tone="error">{error}</InlineResult> : null}
    <details ref={advanced} open={open} onToggle={e => { setOpen(e.currentTarget.open); if (e.currentTarget.open) setEditorMounted(true); }}>
      <summary className="cursor-pointer py-2 text-sm underline">Image decision, brief and review</summary>
      {editorMounted ? <VisualEditor initial={initial} canEdit={canEdit && !copyDirty && !reasonDirty} onChanged={onChanged} /> : null}
    </details>
    <GuardedLink href={`/visuals/${encodeURIComponent(initial.libraryId)}`} className="inline-flex min-h-11 items-center text-sm underline">Open full image editor</GuardedLink>
  </section>;
}
