'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * A Backlog hook edited in place (spreadsheet-style Backlog). Shows the hook as
 * plain text; for the owner it is a button that turns into a real text input
 * (never contentEditable). Enter or blur saves through the parent's `onSave`,
 * Escape reverts without saving. The saving/saved/error status sits next to the
 * cell as visible text, so the outcome is never colour or a spinner alone.
 * Viewers get plain text with no control at all.
 */
export type HookSaveOutcome = { ok: true; note?: string } | { ok: false; message: string };

type Status = { kind: 'saving' } | { kind: 'saved'; note?: string } | { kind: 'error'; message: string };

export function EditableHookCell({ value, canEdit, libraryId, onSave }: { value: string; canEdit: boolean; libraryId: string; onSave: (next: string) => Promise<HookSaveOutcome> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [status, setStatus] = useState<Status | null>(null);
  // Set before the input unmounts so a trailing blur never saves a second time
  // (Enter) or saves at all (Escape).
  const settledRef = useRef(false);
  const displayRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  useEffect(() => {
    if (status?.kind !== 'saved') return;
    const t = setTimeout(() => setStatus(null), 2500);
    return () => clearTimeout(t);
  }, [status]);

  useEffect(() => {
    if (!editing && returnFocus.current) {
      returnFocus.current = false;
      displayRef.current?.focus();
    }
  }, [editing]);

  if (!canEdit) {
    return value ? <span className="copy block">{value}</span> : <span className="text-ink-soft">No hook yet</span>;
  }

  function start() {
    settledRef.current = false;
    setDraft(value);
    setStatus(null);
    setEditing(true);
  }

  function cancel() {
    settledRef.current = true;
    returnFocus.current = true;
    setEditing(false);
    setDraft(value);
  }

  async function commit() {
    if (settledRef.current) return;
    settledRef.current = true;
    returnFocus.current = true;
    setEditing(false);
    const next = draft;
    if (next === value) return;
    setStatus({ kind: 'saving' });
    const outcome = await onSave(next);
    setStatus(outcome.ok ? { kind: 'saved', note: outcome.note } : { kind: 'error', message: outcome.message });
  }

  return (
    <span className="flex min-w-0 flex-col gap-0.5" data-hook-cell>
      {editing ? (
        <input
          type="text"
          value={draft}
          maxLength={500}
          autoFocus
          aria-label={`Hook for ${libraryId}`}
          lang="en-GB"
          spellCheck
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void commit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              cancel();
            }
          }}
          onBlur={() => void commit()}
          className="w-full min-w-0 rounded-sm border border-primary bg-card px-1.5 py-1 text-sm text-ink"
        />
      ) : (
        <button
          ref={displayRef}
          type="button"
          title="Click to edit"
          onClick={start}
          className={`copy group/hook flex min-h-8 w-full items-center gap-1.5 rounded-sm border border-dashed border-line px-1.5 py-1 text-left text-sm hover:border-solid hover:border-primary hover:bg-primary-soft/60 ${value ? 'text-ink' : 'text-ink-soft'}`}
        >
          {/* The visible hook stays in the accessible name; the prefix says what the button does. */}
          <span className="sr-only">Edit hook for {libraryId}: </span>
          <span className="min-w-0 flex-1 truncate">{value || 'No hook yet'}</span>
          <span aria-hidden="true" className="shrink-0 text-ink-soft/50 group-hover/hook:text-primary">
            ✎
          </span>
        </button>
      )}
      {status ? (
        <span role="status" className={`px-1.5 text-xs ${status.kind === 'error' ? 'font-semibold text-block' : 'text-ink-soft'}`}>
          {status.kind === 'saving' ? 'Saving…' : status.kind === 'saved' ? (status.note ?? 'Saved') : status.message}
        </span>
      ) : null}
    </span>
  );
}
