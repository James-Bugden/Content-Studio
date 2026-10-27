'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { isAnyDirty, subscribeDirty, serverSnapshot } from '../dirty-store';
import { useRouter } from 'next/navigation';
import { slotLabel } from '@/domain/slot-label';
import type { PostPanelData } from '@/domain/board';
import type { Gate } from '@/domain/gates';
import type { ReviewCard } from '@/domain/views';
import { newOperationId, postJson } from '@/lib/client/api';
import { buttonClass } from '../button-styles';
import { EditorWorkspace } from '../editor/editor-workspace';
import { GuardedLink } from '../guarded-link';
import { InlineResult } from '../inline-result';
import { PromoteConfirm } from '../schedule/promote-confirm';
import { StateView } from '../state-view';
import { GateChip } from '../status';
import { PlatformPreview } from './platform-preview';
import { ImageSection } from './image-section';
import { PostThumb } from './post-thumb';

/**
 * Post side panel (UX redesign). Everything for one post in place: how it will
 * read on the platform, the single next step with its action, inline editing
 * (with English QA and hooks), the image, scheduling into a slot, and details.
 * Every write uses the same guarded APIs as the full pages.
 */
type Tab = 'overview' | 'edit' | 'details';
type Load = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ok'; data: PostPanelData };
type Transition = 'approve' | 'approve_and_queue' | 'queue' | 'unqueue' | 'skip' | 'request_changes' | 'reopen';
type TransitionOutcome = { ok: true; card: ReviewCard } | { ok: false; code: string; message?: string; blockers?: Gate[] };
type Preview = { ok: true; contentId: string; libraryRevision: string; scheduleRevision: string; preview: { field: string; header: string; before: string; after: string }[] } | { ok: false; problems?: string[]; message?: string };

const DONE: Record<Transition, string> = {
  approve: 'Approved.',
  approve_and_queue: 'Approved and queued for scheduling.',
  queue: 'Queued for scheduling.',
  unqueue: 'Removed from the queue.',
  skip: 'Skipped.',
  request_changes: 'Changes requested.',
  reopen: 'Reopened for review.',
};

export function PostPanel({ libraryId }: { libraryId: string }) {
  const dirty = useSyncExternalStore(subscribeDirty, isAnyDirty, serverSnapshot);
  const router = useRouter();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [tab, setTab] = useState<Tab>('edit');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: 'success' | 'warning' | 'error'; text: string } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewWarning, setPreviewWarning] = useState<string | null>(null);
  const previewRequest = useRef(0);
  const slotOptionsRef = useRef<PostPanelData['slotOptions']>([]);
  useEffect(() => { slotOptionsRef.current = load.state === 'ok' ? load.data.slotOptions : []; }, [load]);
  const pickSlot = useCallback(async (contentId: string, fallback: string[] = []) => {
    const request = ++previewRequest.current;
    setPreview(null);
    setPreviewWarning(null);
    for (const id of [contentId, ...fallback]) {
      const res = await fetch(`/api/schedule/promote/preview?libraryId=${encodeURIComponent(libraryId)}&contentId=${encodeURIComponent(id)}`, { credentials: 'same-origin' }).catch(() => null);
      const body = await res?.json().catch(() => null);
      if (request !== previewRequest.current) return;
      if (res?.ok && body?.ok) { setPreview(body); return; }
      const failedSlot = slotOptionsRef.current?.find(option => option.contentId === id);
      const label = failedSlot ? slotLabel(failedSlot.isoDate, failedSlot.time) : id;
      setPreviewWarning(`${label}: ${body?.problems?.join(' ') || body?.message || 'This slot cannot be used.'}`);
      setPreview(body?.ok === false ? body : { ok: false });
    }
  }, [libraryId]);
  const firstSlot = load.state === 'ok' ? load.data.slotOptions[0]?.contentId : undefined;
  const initialPreview = load.state === 'ok' ? load.data.initialPreview : null;
  const slotOptions = load.state === 'ok' ? load.data.slotOptions : null;
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      if (initialPreview?.contentId === firstSlot) { setPreview(initialPreview ?? null); setPreviewWarning(null); }
      else if (firstSlot) void pickSlot(firstSlot, slotOptions?.slice(1).map((o) => o.contentId));
      else setPreview(null);
    });
    const requests = previewRequest;
    return () => { active = false; requests.current++; };
  }, [firstSlot, initialPreview, slotOptions, pickSlot]);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/panel/post/${encodeURIComponent(libraryId)}`, { credentials: 'same-origin' }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as { ok: boolean; data?: PostPanelData; message?: string } | null;
    if (!res?.ok || !body?.ok || !body.data) {
      setLoad({ state: 'error', message: body?.message ?? 'This post could not be loaded. Nothing was changed.' });
      return;
    }
    const next = body.data;
    setLoad(previous => ({ state: 'ok', data: previous.state === 'ok' && isAnyDirty() ? { ...next, model: previous.data.model } : next }));
  }, [libraryId]);

  useEffect(() => {
    queueMicrotask(() => void refresh());
  }, [refresh]);

  if (load.state === 'loading') return <StateView kind="loading" title="Loading the post" />;
  if (load.state === 'error') return <StateView kind="provider_error" title="Could not open this post" detail={load.message} />;
  const { data } = load;
  const { summary, card, model, canEdit } = data;
  const step = summary.step;
  const previewSlot = preview?.ok ? data.slotOptions.find((o) => o.contentId === preview.contentId) : undefined;

  async function transition(action: Transition) {
    if (dirty) { setResult({ tone: 'warning', text: 'Save or undo the draft before changing its review status.' }); return; }
    setBusy(true);
    setResult(null);
    const res = await postJson<TransitionOutcome>('/api/review/transition', { operationId: newOperationId('review'), libraryId, expectedRevision: card.revision, action });
    setBusy(false);
    const body = res.body as TransitionOutcome;
    if (body.ok) {
      setResult({ tone: 'success', text: DONE[action] });
      router.refresh();
      await refresh();
      return;
    }
    const why = body.blockers?.map((b) => b.message).join(' ');
    setResult({ tone: body.code === 'STALE_READ' ? 'warning' : 'error', text: body.code === 'STALE_READ' ? 'This post changed. The latest version is loaded; check it and try again.' : why || body.message || 'Not done. Nothing was written.' });
    await refresh();
  }

  const draft = model.markdown.state === 'ok' ? model.markdown.body : model.sheet.draft;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-start gap-3">
        <PostThumb thumb={summary.thumb} size="sm" showLabel={false} />
        <div className="min-w-0 flex-1">
          <h2 id="panel-title" className="text-lg font-semibold first-letter:uppercase">
            {summary.title || summary.libraryId}
          </h2>
          <p className="text-sm text-ink-soft">
            {summary.platform} · {summary.reviewStatus}
            {summary.scheduledAs.length ? ` · scheduled` : ''}
          </p>
        </div>
      </header>

      <section aria-label="Next step" className={`rounded-lg border p-3 ${step.urgency === 'now' ? 'border-block bg-block-soft' : 'border-line bg-card'}`}>
        <p className="text-sm">
          <span className="rounded bg-primary-soft px-1.5 py-0.5 text-xs font-semibold text-primary">Next</span>{' '}
          <strong>
            {step.action}
          </strong>
          <span className="text-ink-soft">: {step.why}</span>
        </p>
        {canEdit ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {step.kind === 'review' ? <button type="button" className={buttonClass()} disabled={busy || dirty} onClick={() => void transition('skip')}>Skip</button> : null}
            {step.kind === 'queue' ? <button type="button" className={buttonClass('primary')} disabled={busy || dirty} onClick={() => void transition('queue')}>Queue for scheduling</button> : null}
            {step.kind === 'fix_copy' || step.kind === 'decide_duplicate' ? (
              <button type="button" className={buttonClass('primary')} onClick={() => setTab('edit')}>
                Edit the post
              </button>
            ) : null}
            {['choose_image', 'finish_image', 'approve_image'].includes(step.kind) ? (
              <a href="#panel-image" className={buttonClass('primary')}>Edit image decision</a>
            ) : null}
            {card.reviewStatus === 'Skipped' || card.reviewStatus === 'Changes Requested' ? (
              <button type="button" className={buttonClass()} disabled={busy} onClick={() => void transition('reopen')}>
                Reopen for review
              </button>
            ) : null}
          </div>
        ) : (
          <p className="mt-2 text-xs text-ink-soft">Read-only access.</p>
        )}
        {result ? (
          <div className="mt-3">
            <InlineResult tone={result.tone}>{result.text}</InlineResult>
          </div>
        ) : null}
      </section>

      {step.kind === 'schedule' && canEdit ? (
        <section aria-labelledby="slots-h" className="rounded-lg border border-line bg-card p-3">
          <h3 id="slots-h" className="font-semibold">
            Pick a slot
          </h3>
          {data.slotOptions.length === 0 ? (
            <p className="mt-1 text-sm text-ink-soft">No open {summary.platform} slots in the next three weeks.</p>
          ) : (
            <ul className="mt-2 flex flex-wrap gap-2">
              {data.slotOptions.map((o) => (
                <li key={o.contentId}>
                  <button type="button" aria-pressed={Boolean(preview?.ok && preview.contentId === o.contentId)} className={buttonClass(preview && preview.ok && preview.contentId === o.contentId ? 'primary' : 'secondary')} onClick={() => void pickSlot(o.contentId)}>
                    {slotLabel(o.isoDate, o.time)}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {data.slotOptions.length > 0 ? <div className={`mt-3 flex flex-col ${preview && !preview.ok ? '' : 'h-80'}`}>
          {preview?.ok && previewWarning ? <InlineResult tone="warning">{previewWarning}</InlineResult> : null}
          {preview ? (
            preview.ok ? (
              <div className="flex min-h-0 flex-1 flex-col gap-2">
                <ul className="min-h-0 flex-1 overflow-y-auto text-sm" tabIndex={0} aria-label="Cells to write">
                  {preview.preview.map((r) => (
                    <li key={r.field} className="flex gap-2 border-t border-line py-1">
                      <span className="w-40 shrink-0 font-medium">{r.header}</span>
                      <span className="copy line-clamp-2 min-w-0">{r.after || '(empty)'}</span>
                    </li>
                  ))}
                </ul>
                {previewSlot ? <PromoteConfirm key={`${preview.contentId}-${preview.libraryRevision}-${preview.scheduleRevision}`} slotLabel={slotLabel(previewSlot.isoDate, previewSlot.time)} libraryId={libraryId} contentId={preview.contentId} libraryRevision={preview.libraryRevision} scheduleRevision={preview.scheduleRevision} /> : null}
              </div>
            ) : (
              <InlineResult tone="warning">{preview.problems?.join(' ') || preview.message || 'This slot cannot be used.'}</InlineResult>
            )
          ) : <StateView kind="loading" title="Loading the preview" />}
          </div> : null}
        </section>
      ) : null}

      <div role="tablist" aria-label="Post views" className="flex gap-1 border-b border-line">
        {(['overview', 'edit', 'details'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            type="button"
            aria-selected={tab === t}
            onClick={() => { if (dirty && tab === 'edit' && t !== 'edit') setResult({ tone: 'warning', text: 'Save or undo the draft before changing views.' }); else setTab(t); }}
            className={`min-h-11 px-3 text-sm ${tab === t ? 'border-b-2 border-ink font-semibold' : 'text-ink-soft hover:text-ink'}`}
          >
            {t === 'overview' ? 'Preview' : t === 'edit' ? 'Edit' : 'Details'}
          </button>
        ))}
      </div>

      {tab === 'overview' ? (
        <div role="tabpanel" aria-label="Preview" className="flex flex-col gap-3">
          <PlatformPreview platform={summary.platform} text={draft} thumb={summary.thumb} />
          <div className="flex items-center gap-3">
            <PostThumb thumb={summary.thumb} size="sm" />
            <GuardedLink href={`/visuals/${encodeURIComponent(libraryId)}`} className="text-sm underline">
              Open the image studio
            </GuardedLink>
          </div>
        </div>
      ) : null}

      {tab === 'edit' ? (
        <div role="tabpanel" aria-label="Edit">
          <EditorWorkspace key={model.sheet.revision} model={model} canEdit={canEdit} ns={data.ns} reviewActions inlineImage onSaved={() => { void refresh().then(() => setResult({ tone: 'success', text: model.contentProvider === 'db' ? 'Saved in the database. Drive export is queued.' : 'Saved to the master Markdown and mirrored to the Sheet.' })); }} onReviewed={(text) => { void refresh().then(() => setResult({ tone: 'success', text })); }} />
        </div>
      ) : null}

      <ImageSection key={`${libraryId}-${model.sheet.revision}`} libraryId={libraryId} canEdit={canEdit} dirty={dirty} />

      {tab === 'details' ? (
        <div role="tabpanel" aria-label="Details" className="flex flex-col gap-3 text-sm">
          <ul className="flex flex-col gap-1.5">
            {[...card.gates.blockers, ...card.gates.warnings].map((g, i) => (
              <li key={`${g.code}-${i}`}>
                <GateChip gate={g} />
              </li>
            ))}
            {card.gates.blockers.length === 0 && card.gates.warnings.length === 0 ? <li>Every check passes.</li> : null}
          </ul>
          <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-3 gap-y-1">
            <dt className="text-ink-soft">Library ID</dt>
            <dd className="font-mono">{summary.libraryId}</dd>
            <dt className="text-ink-soft">Source</dt>
            <dd>{summary.source}</dd>
            <dt className="text-ink-soft">Scheduled as</dt>
            <dd className="font-mono">{summary.scheduledAs.join(', ') || 'Not yet'}</dd>
            <dt className="text-ink-soft">Content revision</dt>
            <dd className="font-mono text-xs">{model.sheet.revision}</dd>
            <dt className="text-ink-soft">{model.contentProvider === 'db' ? 'Draft source' : 'Markdown'}</dt>
            <dd className="text-xs">{model.contentProvider === 'db' ? 'Database; Drive is an export' : model.markdown.state === 'ok' ? `rev ${model.markdown.fileRevision}` : `Unavailable (${model.markdown.reason.replace(/_/g, ' ')})`}</dd>
          </dl>
          <GuardedLink href={`/review/${encodeURIComponent(libraryId)}`} className="underline">
            Open the full editor page
          </GuardedLink>
        </div>
      ) : null}
    </div>
  );
}
