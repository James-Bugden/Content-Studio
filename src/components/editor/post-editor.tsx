'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { StepResult } from '@/domain/mutation';
import type { EditorModel } from '@/domain/views';
import { newOperationId, postJson } from '@/lib/client/api';
import { clearRecovery, readRecovery, writeRecovery } from '@/lib/client/recovery';
import { buttonClass } from '../button-styles';
import { ConflictDialog } from '../conflict-dialog';
import { InlineResult } from '../inline-result';
import { RecoveryPanel } from '../recovery-panel';
import { useDirtyGuard } from '../use-dirty-guard';

/**
 * Protected Post Editor (CS-008).
 *
 * - Exact text: the textarea value is never trimmed or normalised (REV-07).
 * - Autosave is tab-local only; the authoritative save is an explicit button.
 * - Every save carries the Sheet revision and Markdown section hash the editor
 *   loaded plus a stable operation id, so a retry cannot double-write and an
 *   external edit becomes a comparison, never last-write-wins (REV-08).
 * - Partial provider failure is shown step by step with a same-operation retry
 *   (DRV-04). Any failure leaves the text in place with copy/download escape
 *   hatches (UX-06).
 */
type SaveResponse =
  | { ok: true; replayed: boolean; steps: StepResult[]; value: { record: { revision: string }; sectionHash: string; driveRevision: string } }
  | { ok: false; code: string; message?: string; steps?: StepResult[]; conflict?: { provider: 'sheet' | 'drive'; current: string }; details?: { reason?: string } };

type Status =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; replayed: boolean }
  | { kind: 'conflict'; provider: 'sheet' | 'drive'; current: string }
  | { kind: 'partial'; steps: StepResult[]; operationId: string }
  | { kind: 'error'; code: string; message: string };

/** What the AI panels need to bind proposals to the exact text and revisions in the editor. */
export type EditorSnapshot = { dirty: boolean; sheetRevision: string; sectionHash: string; markdownOk: boolean };

/** Text the editor opens with: the canonical Markdown section when it loaded, else the Sheet mirror. */
export function initialEditorText(model: EditorModel): string {
  return model.markdown.state === 'ok' ? model.markdown.body : model.sheet.draft;
}

export type PostEditorProps = {
  model: EditorModel;
  canEdit: boolean;
  ns: string;
  /** Controlled text (optional). When given, `onValueChange` receives every change. */
  value?: string;
  onValueChange?: (text: string) => void;
  onSnapshot?: (snapshot: EditorSnapshot) => void;
};

export function PostEditor({ model, canEdit, ns, value, onValueChange, onSnapshot }: PostEditorProps) {
  const textId = useId();
  const initialBase = initialEditorText(model);
  const [base, setBase] = useState(initialBase);
  const [innerText, setInnerText] = useState(initialBase);
  const text = value ?? innerText;
  const setText = (next: string) => {
    if (onValueChange) onValueChange(next);
    else setInnerText(next);
  };
  const [sheetRevision, setSheetRevision] = useState(model.sheet.revision);
  const [sectionHash, setSectionHash] = useState(model.markdown.state === 'ok' ? model.markdown.sectionHash : '');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [restored, setRestored] = useState<string | null>(null);
  const opRef = useRef<{ id: string; text: string } | null>(null);
  const [mismatch, setMismatch] = useState(model.mismatch);
  const dirty = text !== base;
  useDirtyGuard(dirty);

  // Offer tab-local recovery once, never silently replacing the loaded text.
  useEffect(() => {
    // Deferred: sessionStorage exists only in the browser, after hydration.
    const saved = readRecovery(ns, model.libraryId);
    if (saved && saved.text !== initialBase) queueMicrotask(() => setRestored(saved.text));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => {
      writeRecovery(ns, { libraryId: model.libraryId, text, base, sheetRevision, sectionHash, savedAt: Date.now() });
    }, 400);
    return () => clearTimeout(t);
  }, [dirty, text, base, sheetRevision, sectionHash, ns, model.libraryId]);

  const markdownOk = model.markdown.state === 'ok';

  useEffect(() => {
    onSnapshot?.({ dirty, sheetRevision, sectionHash, markdownOk });
  }, [onSnapshot, dirty, sheetRevision, sectionHash, markdownOk]);

  async function save() {
    if (!markdownOk) return;
    // Same operation id for a retry of the same text; a new one if the text changed.
    const op = opRef.current && opRef.current.text === text ? opRef.current : { id: newOperationId('draft'), text };
    opRef.current = op;
    setStatus({ kind: 'saving' });
    const res = await postJson<SaveResponse>(`/api/library/${encodeURIComponent(model.libraryId)}/draft`, {
      operationId: op.id,
      expectedSheetRevision: sheetRevision,
      expectedSectionHash: sectionHash,
      proposed: text,
    });
    const body = res.body as SaveResponse;
    if (body.ok) {
      opRef.current = null;
      setBase(text);
      setSheetRevision(body.value.record.revision);
      setSectionHash(body.value.sectionHash);
      clearRecovery(ns, model.libraryId);
      setMismatch(false);
      setStatus({ kind: 'saved', replayed: body.replayed });
      return;
    }
    if (res.status === 401) {
      setStatus({ kind: 'error', code: 'AUTH_REQUIRED', message: 'You were signed out. Your text is kept in this tab. Sign in again in a new tab, then come back and save.' });
      return;
    }
    if (body.code === 'STALE_READ' && body.conflict) {
      opRef.current = null;
      setStatus({ kind: 'conflict', provider: body.conflict.provider, current: body.conflict.current });
      return;
    }
    if (body.code === 'PARTIAL_FAILURE' && body.steps) {
      setStatus({ kind: 'partial', steps: body.steps, operationId: op.id });
      return;
    }
    if (body.code === 'VALIDATION_FAILED' && body.details?.reason === 'unsafe_markdown_structure') {
      setStatus({
        kind: 'error',
        code: body.code,
        message: 'Not saved: the draft has a heading at the section level (for example "## ...") or an unclosed code fence (```). Either would break the other posts in the master file. Remove it and save again.',
      });
      return;
    }
    setStatus({ kind: 'error', code: body.code, message: body.message ?? 'The save did not complete. Nothing is confirmed as written; your text is kept here.' });
  }

  async function refreshRevisions(): Promise<EditorModel | null> {
    const res = await fetch(`/api/library/${encodeURIComponent(model.libraryId)}/editor`, { credentials: 'same-origin' });
    if (!res.ok) return null;
    const json = (await res.json()) as { ok: boolean; model: EditorModel };
    return json.ok ? json.model : null;
  }

  async function keepMine() {
    const fresh = await refreshRevisions();
    if (!fresh || fresh.markdown.state !== 'ok') {
      setStatus({ kind: 'error', code: 'PROVIDER_UNAVAILABLE', message: 'Could not reload the latest version. Your text is kept here.' });
      return;
    }
    setSheetRevision(fresh.sheet.revision);
    setSectionHash(fresh.markdown.sectionHash);
    setBase(fresh.markdown.body);
    setStatus({ kind: 'idle' });
  }

  async function adoptCurrent() {
    const fresh = await refreshRevisions();
    if (!fresh || fresh.markdown.state !== 'ok') return;
    setSheetRevision(fresh.sheet.revision);
    setSectionHash(fresh.markdown.sectionHash);
    setBase(fresh.markdown.body);
    setText(fresh.markdown.body);
    clearRecovery(ns, model.libraryId);
    setStatus({ kind: 'idle' });
  }

  function copyText() {
    void navigator.clipboard?.writeText(text);
  }

  function downloadText() {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${model.libraryId}-draft.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section aria-labelledby={`${textId}-h`} className="flex flex-col gap-3">
      <h2 id={`${textId}-h`} className="text-lg font-semibold">
        Draft
      </h2>

      {restored !== null ? (
        <InlineResult tone="info">
          <span>This tab has unsaved text from earlier. </span>
          <button
            type="button"
            className="underline"
            onClick={() => {
              setText(restored);
              setRestored(null);
            }}
          >
            Restore it
          </button>
          <span> or </span>
          <button
            type="button"
            className="underline"
            onClick={() => {
              clearRecovery(ns, model.libraryId);
              setRestored(null);
            }}
          >
            discard it
          </button>
          .
        </InlineResult>
      ) : null}

      {model.markdown.state !== 'ok' ? (
        <InlineResult tone="warning">
          The master Markdown section could not be loaded ({model.markdown.reason.replace(/_/g, ' ')}). Saving is disabled so the Sheet and Markdown cannot drift apart. You can still copy the
          text.
        </InlineResult>
      ) : null}

      {mismatch ? (
        <div className="rounded-md border border-warn bg-warn-soft p-3 text-sm">
          <p className="font-semibold">The Sheet draft and the Markdown section differ.</p>
          <p className="mt-1">The editor loaded the Markdown version, which is canonical. Saving will make the Sheet match it exactly. Compare first if you are unsure.</p>
          <details className="mt-2">
            <summary className="cursor-pointer">Show the Sheet version</summary>
            <pre className="copy mt-2 rounded bg-card p-2 font-sans text-sm">{model.sheet.draft}</pre>
            {canEdit ? (
              <button type="button" className={`${buttonClass()} mt-2`} onClick={() => setText(model.sheet.draft)}>
                Start from the Sheet version instead
              </button>
            ) : null}
          </details>
        </div>
      ) : null}

      <label htmlFor={textId} className="text-sm font-medium">
        Post copy <span className="font-normal text-ink-soft">(exact text; line breaks and spacing are kept as typed)</span>
      </label>
      <textarea
        id={textId}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (status.kind === 'saved') setStatus({ kind: 'idle' });
        }}
        readOnly={!canEdit}
        spellCheck
        lang="en-GB"
        rows={Math.min(24, Math.max(8, text.split('\n').length + 2))}
        className="copy w-full rounded-md border border-line bg-card p-3 font-sans text-base leading-relaxed"
      />
      <p className="text-xs text-ink-soft" aria-live="polite">
        {text.length.toLocaleString('en-GB')} characters{dirty ? ' · unsaved changes, kept in this tab until saved' : ' · matches the saved version'}
      </p>

      {status.kind === 'saved' ? (
        <InlineResult tone="success">{status.replayed ? 'Already saved: the Markdown and the Sheet both hold this text.' : 'Saved to the master Markdown and mirrored to the Sheet.'}</InlineResult>
      ) : null}
      {status.kind === 'error' ? <InlineResult tone="error">{status.message}</InlineResult> : null}
      {status.kind === 'partial' ? (
        <RecoveryPanel operationId={status.operationId} steps={status.steps.map((s) => ({ step: s.step, status: s.status, provider: s.provider }))} onRetry={() => void save()} />
      ) : null}

      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonClass('primary')} disabled={!markdownOk || (!dirty && !mismatch) || status.kind === 'saving'} onClick={() => void save()}>
            {status.kind === 'saving' ? 'Saving…' : !dirty && mismatch ? 'Make the Sheet match the Markdown' : 'Save draft'}
          </button>
          <button type="button" className={buttonClass()} disabled={!dirty || status.kind === 'saving'} onClick={() => setText(base)}>
            Undo changes
          </button>
          <button type="button" className={buttonClass()} onClick={copyText}>
            Copy text
          </button>
          <button type="button" className={buttonClass()} onClick={downloadText}>
            Download .txt
          </button>
        </div>
      ) : (
        <p className="text-sm text-ink-soft">Read-only access: editing is disabled.</p>
      )}

      {status.kind === 'conflict' ? (
        <ConflictDialog
          open
          onClose={() => setStatus({ kind: 'idle' })}
          title={status.provider === 'drive' ? 'The Markdown section changed after you opened it' : 'The Sheet row changed after you opened it'}
          description="Nothing was overwritten. Compare the three versions, then choose. Your edit stays in this tab either way."
          base={base}
          current={status.current}
          proposed={text}
          actions={[
            { label: 'Keep mine and review again', variant: 'primary', onSelect: () => void keepMine() },
            { label: 'Use the current version', onSelect: () => void adoptCurrent() },
            { label: 'Copy my version', onSelect: copyText },
          ]}
        />
      ) : null}
    </section>
  );
}
