'use client';

import { useEffect, useId, useRef, useState } from 'react';

/**
 * A single Backlog field edited in place (spreadsheet-style Backlog). Shows the
 * value as plain text; for the owner it is a button that turns into a real text
 * input (never contentEditable), optionally offering existing values already in
 * the Sheet as datalist suggestions so picking one feels like a select. Enter or
 * blur saves through the parent's `onSave`, Escape reverts without saving. The
 * saving/saved/error status sits next to the cell as visible text, so the
 * outcome is never colour or a spinner alone. Viewers get plain text with no
 * control at all.
 */
export type TextCellSaveOutcome = { ok: true; note?: string } | { ok: false; message: string };

type Status = { kind: 'saving' } | { kind: 'saved'; note?: string } | { kind: 'error'; message: string };

export function EditableTextCell({
  value,
  canEdit,
  libraryId,
  fieldLabel,
  placeholder,
  maxLength = 500,
  suggestions,
  displayValue,
  onSave,
}: {
  value: string;
  canEdit: boolean;
  libraryId: string;
  /** e.g. "Hook", "PESTO stage", "Hook template" — used in the accessible name and the empty-state placeholder. */
  fieldLabel: string;
  placeholder: string;
  maxLength?: number;
  /** Existing values already in the Sheet, offered as a datalist so editing feels like picking, not typing blind. */
  suggestions?: readonly string[];
  /** Optional styled rendering while preserving `value` in the accessible edit name. */
  displayValue?: React.ReactNode;
  onSave: (next: string) => Promise<TextCellSaveOutcome>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [status, setStatus] = useState<Status | null>(null);
  const listId = useId();
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
    return value ? <span className="copy block">{displayValue ?? value}</span> : <span className="text-ink-soft">{placeholder}</span>;
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
    <span className="flex min-w-0 flex-col gap-0.5" data-text-cell={fieldLabel}>
      {editing ? (
        <>
          <input
            type="text"
            value={draft}
            maxLength={maxLength}
            autoFocus
            aria-label={`${fieldLabel} for ${libraryId}`}
            list={suggestions && suggestions.length > 0 ? listId : undefined}
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
          {suggestions && suggestions.length > 0 ? (
            <datalist id={listId}>
              {suggestions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          ) : null}
        </>
      ) : (
        <button
          ref={displayRef}
          type="button"
          title="Click to edit"
          onClick={start}
          className={`copy group/cell flex min-h-8 w-full items-center gap-1.5 rounded-sm border border-dashed border-line px-1.5 py-1 text-left text-sm hover:border-solid hover:border-primary hover:bg-primary-soft/60 ${value ? 'text-ink' : 'text-ink-soft'}`}
        >
          {/* The visible value stays in the accessible name; the prefix says what the button does. */}
          <span className="sr-only">
            Edit {fieldLabel.toLowerCase()} for {libraryId}:{' '}
          </span>
          <span className="min-w-0 flex-1 truncate">{value ? (displayValue ?? value) : placeholder}</span>
          <span aria-hidden="true" className="shrink-0 text-ink-soft/50 group-hover/cell:text-primary">
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
