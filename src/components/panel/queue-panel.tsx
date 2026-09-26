'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { readableTitle } from '@/domain/display';
import type { Thumb } from '@/domain/next-steps';
import { newOperationId, postJson } from '@/lib/client/api';
import { buttonClass } from '../button-styles';
import { FormatToolbar } from '../editor/format-toolbar';
import { InlineResult } from '../inline-result';
import { StateView } from '../state-view';
import { useDirtyGuard } from '../use-dirty-guard';
import { PostThumb } from './post-thumb';

/**
 * Backlog idea side panel (`?queue=<Library ID>`; UX redesign). A simpler
 * sibling of PostPanel for idea-stage Content Queue rows: nothing here has QA,
 * review or image status yet, so there is only a hook, a draft and a save.
 * The backend has no single-item read, so this fetches the full backlog list
 * (small row count) and finds the matching item client-side, same as `/api/me`
 * for the read-only check other panels get from their own panel data.
 */
type QueueItem = { libraryId: string; revision: string; row: number; hook: string; slug: string; draftContent: string; thumb: Thumb };
type Load = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ok'; item: QueueItem; canEdit: boolean };
type EditOutcome = { ok: true; item: QueueItem; revision: string; replayed: boolean } | { ok: false; code: string; message?: string };
type ItemResponse = { ok: true; item: QueueItem; canEdit: boolean } | { ok: false; message?: string };

export function QueuePanel({ libraryId }: { libraryId: string }) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [hook, setHook] = useState('');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: 'success' | 'warning' | 'error'; text: string } | null>(null);
  const hookRef = useRef<HTMLTextAreaElement>(null);
  const draftRef = useRef<HTMLTextAreaElement>(null);

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/backlog/${encodeURIComponent(libraryId)}`, { credentials: 'same-origin', cache: 'no-store' });
    const body = (await response.json().catch(() => null)) as ItemResponse | null;
    if (!response.ok || !body?.ok) {
      setLoad({ state: 'error', message: (body && !body.ok && body.message) || 'The idea could not be loaded. Nothing was changed.' });
      return;
    }
    const { item, canEdit } = body;
    setHook(item.hook);
    setDraft(item.draftContent);
    setLoad({ state: 'ok', item, canEdit });
  }, [libraryId]);

  useEffect(() => {
    queueMicrotask(() => void refresh());
  }, [refresh]);

  // Unsaved edits are registered with the shared dirty store, so the panel's
  // Close / Escape and every GuardedLink ask before discarding them (UX-04),
  // exactly as PostEditor does for a post. Computed before the early returns so
  // the hook order stays stable.
  const dirty = load.state === 'ok' && (hook !== load.item.hook || draft !== load.item.draftContent);
  useDirtyGuard(dirty);

  if (load.state === 'loading') return <StateView kind="loading" title="Loading the idea" />;
  if (load.state === 'error') return <StateView kind="provider_error" title="Could not open this idea" detail={load.message} />;
  const { item, canEdit } = load;

  async function save() {
    const patch: { currentHook?: string; draftContent?: string } = {};
    if (hook !== item.hook) patch.currentHook = hook;
    if (draft !== item.draftContent) patch.draftContent = draft;
    if (Object.keys(patch).length === 0) return;
    setBusy(true);
    setResult(null);
    const res = await postJson<EditOutcome>('/api/backlog/edit', { operationId: newOperationId('backlog'), libraryId, expectedRevision: item.revision, patch });
    setBusy(false);
    const body = res.body as EditOutcome;
    if (body.ok) {
      setResult({ tone: 'success', text: body.replayed ? 'Already saved: this idea already holds this text.' : 'Saved.' });
      setLoad({ state: 'ok', item: body.item, canEdit });
      setHook(body.item.hook);
      setDraft(body.item.draftContent);
      return;
    }
    setResult({
      tone: body.code === 'STALE_READ' ? 'warning' : 'error',
      text: body.code === 'STALE_READ' ? 'This idea changed elsewhere. The latest version is loaded; check it and try again.' : body.message || 'Not saved. Nothing was written.',
    });
    await refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-start gap-3">
        <PostThumb thumb={item.thumb} size="sm" showLabel={false} />
        <div className="min-w-0 flex-1">
          <h2 id="panel-title" className="text-lg font-semibold first-letter:uppercase">
            {item.hook || readableTitle(item.slug) || item.libraryId}
          </h2>
          <p className="text-sm text-ink-soft">Idea-stage · not yet reviewed</p>
        </div>
      </header>

      {!canEdit ? <p className="text-sm text-ink-soft">Read-only access.</p> : null}

      <div className="flex flex-col gap-2">
        <label htmlFor="queue-hook" className="text-sm font-medium">
          Hook
        </label>
        <FormatToolbar
          textarea={hookRef}
          text={hook}
          platform=""
          disabled={!canEdit}
          onChange={(next) => {
            setHook(next);
            if (result) setResult(null);
          }}
        />
        <textarea
          ref={hookRef}
          id="queue-hook"
          value={hook}
          onChange={(e) => {
            setHook(e.target.value);
            if (result) setResult(null);
          }}
          readOnly={!canEdit}
          spellCheck
          lang="en-GB"
          rows={2}
          className="copy w-full rounded-md border border-line bg-card p-3 font-sans text-base leading-relaxed"
        />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="queue-draft" className="text-sm font-medium">
          Draft
        </label>
        <FormatToolbar
          textarea={draftRef}
          text={draft}
          platform=""
          disabled={!canEdit}
          onChange={(next) => {
            setDraft(next);
            if (result) setResult(null);
          }}
        />
        <textarea
          ref={draftRef}
          id="queue-draft"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (result) setResult(null);
          }}
          readOnly={!canEdit}
          spellCheck
          lang="en-GB"
          rows={Math.min(24, Math.max(8, draft.split('\n').length + 2))}
          className="copy w-full rounded-md border border-line bg-card p-3 font-sans text-base leading-relaxed"
        />
      </div>

      {result ? <InlineResult tone={result.tone}>{result.text}</InlineResult> : null}

      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonClass('primary')} disabled={busy || !dirty} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
