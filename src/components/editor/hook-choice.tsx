'use client';

import { useState } from 'react';
import { parseHookAlternatives } from '@/domain/hook-alternatives';
import { newOperationId, postJson } from '@/lib/client/api';
import { buttonClass } from '../button-styles';

/**
 * Hook Alternatives and the chosen hook, under PESTO in the post editor (CS-056).
 * "Use this" puts the hook at the top of the post text (#242) and marks the draft
 * edited, so one Save writes the text and the hook together; Undo takes it back.
 * Typing in the field still saves only the Current Hook cell with the row's
 * revision, and like PESTO it waits for unsaved copy to be saved first.
 */
type Outcome = { ok: true; currentHook: string; revision: string; replayed: boolean } | { ok: false; code: string; message?: string };
type Status = { kind: 'saving' } | { kind: 'saved'; note?: string } | { kind: 'error'; message: string };

export function HookChoice({ libraryId, alternatives, currentHook, revision, canEdit, blockedReason, onSaved, onUse, pendingHook = null, contentStore = 'Sheet' }: {
  contentStore?: 'Sheet' | 'database';
  libraryId: string;
  alternatives: string;
  currentHook: string;
  revision: string;
  canEdit: boolean;
  /** Why saving is paused (e.g. unsaved copy); the field stays editable. */
  blockedReason?: string;
  onSaved: (revision: string) => void;
  /** Put this hook at the top of the post text. */
  onUse: (hook: string) => void;
  /** Chosen but not saved yet; it saves with the draft. */
  pendingHook?: string | null;
}) {
  const [text, setText] = useState(currentHook);
  const [status, setStatus] = useState<Status | null>(null);
  const items = parseHookAlternatives(alternatives);
  const changed = text.trim() !== currentHook.trim();
  const shown = pendingHook ?? text;

  async function save() {
    setStatus({ kind: 'saving' });
    const res = await postJson<Outcome>(`/api/library/${encodeURIComponent(libraryId)}/fields`, {
      operationId: newOperationId('hook'),
      libraryId,
      expectedRevision: revision,
      patch: { currentHook: text },
    });
    const body = res.body as Outcome;
    if (body.ok) {
      setStatus({ kind: 'saved', note: body.replayed ? 'Already saved' : undefined });
      onSaved(body.revision);
      return;
    }
    setStatus({
      kind: 'error',
      message: body.code === 'STALE_READ' ? `This post changed in the ${contentStore}. Reload, then try again.`
        : body.code === 'FORBIDDEN' ? 'Not saved: this account cannot edit posts.'
          : body.message || 'Not saved. Nothing was written.',
    });
  }

  return (
    <section aria-labelledby={`hooks-${libraryId}`} className="flex flex-col gap-3">
      <h2 id={`hooks-${libraryId}`} className="text-sm font-semibold">Hook alternatives</h2>
      {items.length === 0 ? <p className="text-xs text-ink-soft">No saved alternatives.</p> : (
        <ol className="flex flex-col gap-2">
          {items.map((alt, i) => (
            <li key={i} className="flex items-start gap-3 rounded-md border border-line bg-card p-2.5">
              <div className="min-w-0 flex-1">
                {alt.score || alt.template ? <p className="flex min-w-0 items-baseline gap-1.5 text-xs text-ink-soft">
                  {alt.score ? <span className="shrink-0 font-semibold tabular-nums text-ink">{alt.score}</span> : null}
                  {alt.template ? <span className="break-words">{alt.template}</span> : null}
                </p> : null}
                <p className="break-words text-sm">{alt.hook}</p>
              </div>
              {canEdit ? <button type="button" className={buttonClass('secondary', 'sm')} onClick={() => { setStatus(null); onUse(alt.hook); }}
                aria-label={`Use alternative ${i + 1} as the hook`}>Use this</button> : null}
            </li>
          ))}
        </ol>
      )}
      <label htmlFor={`chosen-hook-${libraryId}`} className="text-sm font-semibold">Chosen hook</label>
      {canEdit ? <>
        <textarea
          id={`chosen-hook-${libraryId}`}
          value={shown}
          readOnly={pendingHook !== null}
          maxLength={500}
          rows={2}
          onChange={(e) => { setText(e.target.value); setStatus(null); }}
          className="w-full rounded-md border border-line bg-card px-3 py-2 text-sm"
        />
        <div className="flex flex-wrap items-center gap-2">
          {pendingHook === null ? <button type="button" className={buttonClass('secondary', 'sm')} disabled={!changed || status?.kind === 'saving' || Boolean(blockedReason)} onClick={() => void save()}>
            {status?.kind === 'saving' ? 'Saving…' : 'Save hook'}
          </button> : null}
          {changed && blockedReason && pendingHook === null ? <span className="text-xs text-ink-soft">{blockedReason}</span> : null}
          {pendingHook !== null ? <span role="status" className="text-xs font-semibold">Saves with the draft</span> : null}
          {status && status.kind !== 'saving' ? <span role="status" className={`text-xs ${status.kind === 'error' ? 'font-semibold text-block' : 'text-ink-soft'}`}>
            {status.kind === 'saved' ? (status.note ?? 'Saved') : status.message}
          </span> : null}
        </div>
      </> : <p id={`chosen-hook-${libraryId}`} className="text-sm">{currentHook || '—'}</p>}
    </section>
  );
}
