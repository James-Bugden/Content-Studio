'use client';

import { useState } from 'react';
import { parseHookAlternatives } from '@/domain/hook-alternatives';
import { newOperationId, postJson } from '@/lib/client/api';
import { buttonClass } from '../button-styles';

/**
 * Hook Alternatives and the chosen hook, under PESTO in the post editor (CS-056).
 * The alternatives are read-only; "Use this" copies one into the chosen-hook
 * field, where it can be edited before saving. Saving writes only the Sheet's
 * Current Hook cell with the row's revision. Like PESTO, it waits for unsaved
 * copy to be saved first, because both save against the same row revision.
 */
type Outcome = { ok: true; currentHook: string; revision: string; replayed: boolean } | { ok: false; code: string; message?: string };
type Status = { kind: 'saving' } | { kind: 'saved'; note?: string } | { kind: 'error'; message: string };

export function HookChoice({ libraryId, alternatives, currentHook, revision, canEdit, blockedReason, onSaved }: {
  libraryId: string;
  alternatives: string;
  currentHook: string;
  revision: string;
  canEdit: boolean;
  /** Why saving is paused (e.g. unsaved copy); the field stays editable. */
  blockedReason?: string;
  onSaved: (revision: string) => void;
}) {
  const [text, setText] = useState(currentHook);
  const [status, setStatus] = useState<Status | null>(null);
  const items = parseHookAlternatives(alternatives);
  const changed = text.trim() !== currentHook.trim();

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
      message: body.code === 'STALE_READ' ? 'This post changed in the Sheet. Reload, then try again.'
        : body.code === 'FORBIDDEN' ? 'Not saved: this account cannot edit posts.'
          : body.message || 'Not saved. Nothing was written.',
    });
  }

  return (
    <section aria-labelledby={`hooks-${libraryId}`} className="flex flex-col gap-3">
      <h3 id={`hooks-${libraryId}`} className="text-sm font-semibold">Hook alternatives</h3>
      {items.length === 0 ? <p className="text-sm text-ink-soft">No alternatives in the Sheet for this post.</p> : (
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
              {canEdit ? <button type="button" className={buttonClass('secondary', 'sm')} onClick={() => { setText(alt.hook); setStatus(null); }}
                aria-label={`Use alternative ${i + 1} as the chosen hook`}>Use this</button> : null}
            </li>
          ))}
        </ol>
      )}
      <label htmlFor={`chosen-hook-${libraryId}`} className="text-sm font-semibold">Chosen hook</label>
      {canEdit ? <>
        <textarea
          id={`chosen-hook-${libraryId}`}
          value={text}
          maxLength={500}
          rows={2}
          onChange={(e) => { setText(e.target.value); setStatus(null); }}
          placeholder="Type or pick the hook you want to use"
          className="w-full rounded-md border border-line bg-card px-3 py-2 text-sm"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={buttonClass('secondary', 'sm')} disabled={!changed || status?.kind === 'saving' || Boolean(blockedReason)} onClick={() => void save()}>
            {status?.kind === 'saving' ? 'Saving…' : 'Save hook'}
          </button>
          {changed && blockedReason ? <span className="text-xs text-ink-soft">{blockedReason}</span> : null}
          {status && status.kind !== 'saving' ? <span role="status" className={`text-xs ${status.kind === 'error' ? 'font-semibold text-block' : 'text-ink-soft'}`}>
            {status.kind === 'saved' ? (status.note ?? 'Saved') : status.message}
          </span> : null}
        </div>
      </> : <p id={`chosen-hook-${libraryId}`} className="text-sm">{currentHook || '—'}</p>}
    </section>
  );
}
