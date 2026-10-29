'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MAX_OPTIONS, type ImageOption } from '@/domain/image-options';
import type { ImageOutcome, ImageState } from '@/domain/image-pipeline';
import { newOperationId, postJson } from '@/lib/client/api';
import { buttonClass } from '../button-styles';
import { GuardedLink } from '../guarded-link';
import { TransferImage } from '../image-transfer';
import { invalidateEditor } from './editor-cache';
import { SketchOptionCard } from './sketch-options';

type Kind = 'check' | 'revise' | 'approve' | 'plan' | 'create' | 'choose' | 'more' | 'force';
type Extra = { optionId?: string; sketch?: string; renderBrief?: Record<string, unknown> };

/**
 * The Image section of the post panel. The one-click "Check with AI" (and the
 * Backlog "Check images") saves the verdict and 1 to 3 ranked ASCII sketch options
 * on the post, so they are all here without another AI call. "Make image" on an
 * option approves that sketch and renders the real image in one step (#248).
 * Posts checked before options existed keep the single-sketch controls.
 */
export function ImageSection({ libraryId, canEdit, dirty = false }: { libraryId: string; canEdit: boolean; dirty?: boolean }) {
  const router = useRouter();
  const [image, setImage] = useState<ImageState | null>(null);
  const [busy, setBusy] = useState<'' | 'make' | 'more' | 'check' | 'force' | 'other'>('');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState('');
  const [noMore, setNoMore] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const operations = useRef(new Map<string, string>());
  const load = useCallback(async () => {
    const response = await fetch(`/api/images?id=${encodeURIComponent(libraryId)}`, { cache: 'no-store' }).catch(() => null);
    const result = await response?.json().catch(() => null) as ImageOutcome | undefined;
    if (result?.ok && result.image) setImage(result.image);
    else setMessage('Could not load the image decision. Reopen the post to retry.');
  }, [libraryId]);
  useEffect(() => {
    if (dirty) return;
    queueMicrotask(() => void load());
  }, [load, dirty]);
  // The one-click check saves options while this section is open.
  useEffect(() => {
    const saved = (event: Event) => { if ((event as CustomEvent<{ libraryId: string }>).detail?.libraryId === libraryId) { setNoMore(false); void load(); } };
    window.addEventListener('cs:image-options-saved', saved);
    return () => window.removeEventListener('cs:image-options-saved', saved);
  }, [libraryId, load]);

  const send = async (kind: Kind, revision: string, extra: Extra = {}) => {
    const key = JSON.stringify([libraryId, kind, revision, kind === 'revise' ? note : '', extra]);
    const operationId = operations.current.get(key) ?? newOperationId('image');
    operations.current.set(key, operationId);
    const result = (await postJson<ImageOutcome>('/api/images', {
      libraryId, expectedRevision: revision, operationId, action: kind, ...(kind === 'revise' ? { note } : {}), ...extra,
    })).body;
    if (result.ok) operations.current.delete(key);
    return result;
  };
  function finish(changed: boolean, failed: Extract<ImageOutcome, { ok: false }> | null) {
    if (failed && ['STALE_READ', 'CONFLICT'].includes(failed.code)) void load();
    if (changed) {
      invalidateEditor(libraryId);
      window.dispatchEvent(new CustomEvent('cs:post-image-changed', { detail: { libraryId } }));
    }
    router.refresh();
  }

  /** Make image is two requests: plan (the AI step), then create (the render only). */
  async function createImage(revision: string): Promise<ImageOutcome> {
    const planned = await send('plan', revision);
    if (!planned.ok || !planned.renderBrief) return planned.ok ? { ok: false, code: 'PROVIDER_UNAVAILABLE', message: 'The image plan was empty. Try again.' } : planned;
    return send('create', planned.image.revision, { renderBrief: planned.renderBrief });
  }

  /** Legacy single-sketch controls (posts without options). */
  async function action(kind: 'check' | 'revise' | 'approve' | 'create') {
    if (!image || busy || dirty) return;
    setBusy(kind === 'check' ? 'check' : 'other'); setMessage('');
    try {
      let result = await (kind === 'create' ? createImage(image.revision) : send(kind, image.revision));
      const changed = result.ok;
      if (result.ok) {
        setImage(result.image); setNoMore(false);
        if (kind === 'approve') {
          setMessage('Sketch approved. Creating image...');
          result = await createImage(result.image.revision);
          if (result.ok) setImage(result.image);
        }
      }
      setMessage(result.ok ? kind === 'approve' || kind === 'create' ? 'Image created. Review it in the image studio.' : 'Image decision saved.' : result.message);
      finish(changed, result.ok ? null : result);
    } finally { setBusy(''); }
  }

  /** Choose the option's sketch (approves it) and render the image in one step. */
  async function make(option: ImageOption, sketch: string | undefined) {
    if (!image || busy || dirty) return;
    setBusy('make'); setMessage(`Making the image from "${option.title}"...`);
    let changed = false;
    try {
      let current = image;
      const already = current.chosenId === option.id && current.approval === 'approved' && (sketch === undefined || sketch === current.sketch);
      if (!already) {
        const chosen = await send('choose', current.revision, { optionId: option.id, ...(sketch === undefined ? {} : { sketch }) });
        if (!chosen.ok) { setMessage(chosen.message); finish(false, chosen); return; }
        changed = true; current = chosen.image; setImage(chosen.image);
      }
      const made = await createImage(current.revision);
      if (!made.ok) {
        setMessage(`Sketch chosen, but the image was not made. ${made.message}`);
        finish(changed, made);
        return;
      }
      setImage(made.image); changed = true;
      setMessage('Image made. Copy or download it below, or review it in the image studio.');
      finish(true, null);
    } finally { setBusy(''); }
  }

  async function more() {
    if (!image || busy || dirty) return;
    setMoreOpen(true); setBusy('more'); setMessage('Finding more layouts...');
    try {
      const result = await send('more', image.revision);
      if (!result.ok) { setMessage(result.message); finish(false, result); return; }
      setImage(result.image);
      const added = result.image.options.length - image.options.length;
      setNoMore(Boolean(result.noMore) || added === 0 || result.image.options.length >= MAX_OPTIONS);
      setMessage(added > 0 ? `${added} more ${added === 1 ? 'option' : 'options'} added.` : 'No other layout fits this post.');
      finish(false, null);
    } finally { setBusy(''); }
  }

  async function force() {
    if (!image || busy || dirty) return;
    setBusy('force'); setMessage('Drafting sketch options...');
    try {
      const result = await send('force', image.revision);
      if (!result.ok) { setMessage(result.message); finish(false, result); return; }
      setImage(result.image); setNoMore(false);
      setMessage('Sketch options ready. Choose one to make the image.');
      finish(true, null);
    } finally { setBusy(''); }
  }

  const options = image?.options ?? [];
  const working = busy !== '';
  return <section id="image-section" aria-labelledby="image-section-heading" className="min-w-0 space-y-3 rounded-lg border border-line bg-card p-3">
    <h3 id="image-section-heading" className="font-semibold">Image check</h3>
    {image ? <>
      {image.decision === 'undecided' && !image.reason ? <p className="text-sm text-ink-soft">No image decision yet.</p>
        : <p className="min-w-0 text-sm" data-image-verdict={image.decision}>
          {image.decision === 'undecided' ? null : <><strong>{image.decision === 'needs_image' ? 'Needs an image' : 'No image needed'}</strong>{' · '}</>}
          <span className="text-ink-soft">{image.reason || 'No reason recorded.'}</span>
        </p>}
      {canEdit && image.decision === 'no_image' ? <div>
        <button type="button" className={buttonClass()} disabled={working || dirty} onClick={() => void force()}>Needs an image anyway</button>
      </div> : null}

      {options.length > 0 && image.decision !== 'no_image' ? <>
        <ol aria-label="Sketch options" className="min-w-0 space-y-3">
          {options.map((option, i) => <SketchOptionCard key={option.id} option={option} index={i} chosen={image.chosenId === option.id}
            busy={working || dirty} canEdit={canEdit} onMake={(o, sketch) => void make(o, sketch)} />)}
        </ol>
        {canEdit ? <div className="space-y-2">
          {options.length < MAX_OPTIONS && !noMore ? <button type="button" className={buttonClass()} aria-expanded={moreOpen} aria-controls="more-options-status" disabled={working || dirty} onClick={() => void more()}>
            {busy === 'more' ? 'Finding more...' : 'More options'}</button> : null}
          <p id="more-options-status" hidden={!moreOpen && !noMore} className="text-sm text-ink-soft">
            {options.length >= MAX_OPTIONS ? `All ${MAX_OPTIONS} options are shown.` : noMore ? 'No other layout fits this post.' : ''}
          </p>
        </div> : null}
      </> : null}

      {options.length === 0 && image.sketch ? <><pre aria-label="Image sketch" className="max-w-full overflow-x-auto rounded bg-paper p-3 font-mono text-xs">{image.sketch}</pre>
        <p className="text-sm">{image.approval === 'approved' ? 'Sketch approved' : image.approval === 'stale' ? 'Post changed. Revise the sketch.' : 'Sketch awaiting approval'}</p></> : null}
      {canEdit ? <div className="flex flex-wrap items-center gap-2">
        <button className={buttonClass(options.length === 0 && !image.sketch ? 'primary' : undefined)} disabled={working || dirty} onClick={() => void action('check')}>{options.length ? 'Check again' : 'Check images'}</button>
        {options.length === 0 && image.sketch ? <>
          <button className={buttonClass('primary')} disabled={working || dirty || image.approval !== 'pending'} onClick={() => void action('approve')}>Approve sketch</button>
          <label className="w-full text-sm">Revision note<input value={note} onChange={e => setNote(e.target.value)} maxLength={1000} disabled={working} className="mt-1 min-h-11 w-full rounded border border-line bg-card px-3" /></label>
          <button className={buttonClass()} disabled={working || dirty || !note.trim()} onClick={() => void action('revise')}>Revise sketch</button>
          <button className={buttonClass()} disabled={working || dirty || image.approval !== 'approved'} onClick={() => void action('create')}>Create image</button>
        </> : null}
      </div> : null}

      {image.hasImage && image.imageUrl ? <figure className="min-w-0 space-y-2">
        <TransferImage src={`${image.imageUrl}?v=${image.revision}`} alt="The image made from the chosen sketch" filename={libraryId} contentId={libraryId}
          className="h-auto max-w-full rounded border border-line" />
      </figure> : null}
      {image.hasImage ? <GuardedLink href={`/visuals/${encodeURIComponent(libraryId)}`} className="inline-flex min-h-11 items-center text-sm underline">Review image</GuardedLink> : null}
    </> : <p className="text-sm">Loading image decision...</p>}
    {dirty ? <p className="text-sm">Save or undo the draft before changing the image.</p> : null}
    <p aria-live="polite" className="text-sm">{busy && !message ? 'Working...' : message}</p>
  </section>;
}
