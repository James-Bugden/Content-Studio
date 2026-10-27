'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ImageOutcome, ImageState } from '@/domain/image-pipeline';
import { newOperationId, postJson } from '@/lib/client/api';
import { buttonClass } from '../button-styles';
import { GuardedLink } from '../guarded-link';
import { invalidateEditor } from './editor-cache';

export function ImageSection({ libraryId, canEdit, dirty = false }: { libraryId: string; canEdit: boolean; dirty?: boolean }) {
  const router = useRouter();
  const [image, setImage] = useState<ImageState | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [message, setMessage] = useState('');
  const operations = useRef(new Map<string, string>());
  const load = useCallback(async () => {
    const response = await fetch(`/api/images?id=${encodeURIComponent(libraryId)}`, { cache: 'no-store' }).catch(() => null);
    const result = await response?.json().catch(() => null) as ImageOutcome | undefined;
    if (result?.ok && result.image) setImage(result.image);
    else setMessage('Could not load the image decision. Reopen the post to retry.');
  }, [libraryId]);
  useEffect(() => { if (!dirty) void load(); }, [load, dirty]);
  async function action(action: 'check' | 'revise' | 'approve' | 'create') {
    if (!image || busy || dirty) return;
    setBusy(true); setMessage('');
    const send = async (kind: typeof action, revision: string) => {
      const key = JSON.stringify([libraryId, kind, revision, kind === 'revise' ? note : '']);
      const operationId = operations.current.get(key) ?? newOperationId('image');
      operations.current.set(key, operationId);
      const result = (await postJson<ImageOutcome>('/api/images', {
        libraryId, expectedRevision: revision, operationId, action: kind, ...(kind === 'revise' ? { note } : {}),
      })).body;
      if (result.ok) operations.current.delete(key);
      return result;
    };
    try {
      let result = await send(action, image.revision);
      const changed = result.ok;
      if (result.ok) {
        setImage(result.image);
        if (action === 'approve') {
          setMessage('Sketch approved. Creating image...');
          result = await send('create', result.image.revision);
          if (result.ok) setImage(result.image);
        }
      }
      setMessage(result.ok ? action === 'approve' || action === 'create' ? 'Image created. Review it in the image studio.' : 'Image decision saved.' : result.message);
      if (!result.ok && ['STALE_READ', 'CONFLICT'].includes(result.code)) await load();
      if (changed) {
        invalidateEditor(libraryId);
        window.dispatchEvent(new CustomEvent('cs:post-image-changed', { detail: { libraryId } }));
      }
      router.refresh();
    } finally { setBusy(false); }
  }
  return <section aria-labelledby="image-section-heading" className="min-w-0 space-y-3 rounded-lg border border-line bg-card p-3">
    <h3 id="image-section-heading" className="font-semibold">Image sketch and check</h3>
    {image ? <>
      <p className="text-sm text-ink-soft">{image.reason || 'No image decision yet.'}</p>
      {image.sketch ? <><pre aria-label="Image sketch" className="max-w-full overflow-x-auto rounded bg-paper p-3 font-mono text-xs">{image.sketch}</pre>
        <p className="text-sm">{image.approval === 'approved' ? 'Sketch approved' : image.approval === 'stale' ? 'Post changed. Revise the sketch.' : 'Sketch awaiting approval'}</p></> : null}
      {canEdit ? <div className="flex flex-wrap items-center gap-2">
        <button className={buttonClass()} disabled={busy || dirty} onClick={() => void action('check')}>Check images</button>
        {image.sketch ? <>
          <button className={buttonClass('primary')} disabled={busy || dirty || image.approval !== 'pending'} onClick={() => void action('approve')}>Approve sketch</button>
          <label className="w-full text-sm">Revision note<input value={note} onChange={e => setNote(e.target.value)} maxLength={1000} disabled={busy} className="mt-1 min-h-11 w-full rounded border border-line bg-card px-3" /></label>
          <button className={buttonClass()} disabled={busy || dirty || !note.trim()} onClick={() => void action('revise')}>Revise sketch</button>
          <button className={buttonClass()} disabled={busy || dirty || image.approval !== 'approved'} onClick={() => void action('create')}>Create image</button>
        </> : null}
      </div> : null}
      {image.hasImage ? <GuardedLink href={`/visuals/${encodeURIComponent(libraryId)}`} className="inline-flex min-h-11 items-center text-sm underline">Review image</GuardedLink> : null}
    </> : <p className="text-sm">Loading image decision...</p>}
    {dirty ? <p className="text-sm">Save or undo the draft before changing the image.</p> : null}
    <p role="status" className="text-sm">{busy ? message || 'Working...' : message}</p>
  </section>;
}
