'use client';

import { useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { StepResult } from '@/domain/mutation';
import type { EditorModel } from '@/domain/views';
import { newOperationId, postJson } from '@/lib/client/api';
import { clearRecovery, readRecovery, writeRecovery, type RecoveryEntry } from '@/lib/client/recovery';
import { buttonClass } from '../button-styles';
import { ConflictDialog } from '../conflict-dialog';
import { FormatToolbar } from './format-toolbar';
import { InlineResult } from '../inline-result';
import { RecoveryPanel } from '../recovery-panel';
import { useDirtyGuard } from '../use-dirty-guard';
import { fingerprint } from '@/domain/hash';
import { savedSelection as selectionFromSaved, type SaveSelection, type PostProperties } from '@/domain/post-versions';
import type { MutationResult } from '@/domain/mutation';
import { emptyHistory, mapOffset, pushHistory, redoHistory, undoHistory, type History, type Snapshot } from '@/domain/edit-history';
import { placeHookInText } from '@/domain/hook-text';
import { captureScroll } from './scroll-memory';

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
  | { ok: false; code: string; message?: string; steps?: StepResult[]; conflict?: { provider: 'sheet' | 'db' | 'drive'; current: string }; details?: { reason?: string } };

type Status =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; replayed: boolean; refreshPending: boolean }
  | { kind: 'conflict'; provider: 'sheet' | 'db' | 'drive'; current: string }
  | { kind: 'partial'; steps: StepResult[]; operationId: string }
  | { kind: 'error'; code: string; message: string };

/** What the AI panels need to bind proposals to the exact text and revisions in the editor. */
export type EditorSnapshot = { dirty: boolean; sheetRevision: string; sectionHash: string; markdownOk: boolean; /** Sheet draft and Markdown section differ; the workspace shows the notice (CS-058). */ mismatch: boolean };

/** Text the editor opens with: the canonical Markdown section when it loaded, else the Sheet mirror. */
export function initialEditorText(model: EditorModel): string {
  return model.markdown.state === 'ok' ? model.markdown.body : model.sheet.draft;
}

function markdownFailure(model: Extract<EditorModel['markdown'], { state: 'unavailable' }>): string {
  if (model.reason === 'no_link') return 'This row has no usable master Markdown link. Check its saved source link.';
  if (model.reason === 'missing_section') return 'The master file has no section for this post. Check the source file.';
  if (model.reason === 'duplicate_section') return 'The master file has more than one section for this post. Resolve the duplicate before editing.';
  if (model.reason === 'trashed') return 'The master file is in the Drive bin. Restore it before editing.';
  switch (model.code) {
    case 'FORBIDDEN': return 'Google Drive denied access to the master file. Check that it is shared with the configured service account.';
    case 'NOT_FOUND': return 'Google Drive could not find the master file. Check that its link and sharing are still valid.';
    case 'RATE_LIMITED': return 'Google Drive is limiting reads. Try again shortly.';
    case 'CONFIG_MISSING': return 'Google Drive access is not configured. Check the service account setup.';
    case 'PROVIDER_UNAVAILABLE': return 'Google Drive could not respond. Try again shortly.';
    default: return 'Google Drive could not load the master file. Check its link and access.';
  }
}

export type PostEditorProps = {
  selection?: SaveSelection;
  onSelectionChange?: (value: SaveSelection) => void;
  saveAsControl?: React.ReactNode;
  model: EditorModel;
  canEdit: boolean;
  ns: string;
  /** Controlled text (optional). When given, `onValueChange` receives every change. */
  value?: string;
  onValueChange?: (text: string) => void;
  onSnapshot?: (snapshot: EditorSnapshot) => void;
  onSaved?: () => void;
  /** Any save that did not complete (error, conflict, partial, signed out). */
  onSaveFailed?: () => void;
  /** Put the cursor in the copy on open, so a bulk pass can type straight away (CS-047). */
  autoFocus?: boolean;
  /** Rendered above the text box, on the left (the AI check button). */
  assist?: React.ReactNode;
  /** Lets the workspace make history-aware edits (hook choice, applied checks). */
  handleRef?: React.Ref<PostEditorHandle>;
  /** The chosen hook that will be saved together with the text, or null. */
  onPendingHookChange?: (hook: string | null) => void;
  /** A save also wrote this hook. */
  onHookSaved?: (hook: string) => void;
};

export type PostEditorHandle = {
  /** Carry on from a newer row revision after a write elsewhere (the image decision). */
  setRevision: (revision: string) => void;
  /** Replace the whole text as one undoable step. */
  replaceText: (next: string) => void;
  /** Put the hook at the top of the text, remember it to save with the draft, undoable. */
  applyHook: (hook: string) => void;
};

const subscribeHydration = () => () => {};
const clientHydrated = () => true;
const serverHydrated = () => false;

export function PostEditor({ model, canEdit, ns, value, onValueChange, onSnapshot, onSaved, onSaveFailed, autoFocus = false, selection, saveAsControl, onSelectionChange, assist, handleRef, onPendingHookChange, onHookSaved }: PostEditorProps) {
  // SSR copy is readable immediately, but input must wait until React owns the
  // textarea. Otherwise hydration can reset a selection during a fill/keystroke.
  const contentStore = model.contentProvider === 'db' ? 'database' : 'Sheet';
  const hydrated = useSyncExternalStore(subscribeHydration, clientHydrated, serverHydrated);
  const textId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
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
  const notifySaved = useRef(false);
  const [restored, setRestored] = useState<RecoveryEntry | null>(null);
  const opRef = useRef<{ id: string; text: string } | null>(null);
  const [mismatch, setMismatch] = useState(model.mismatch);
  const selectionKey = JSON.stringify(selection);
  const [savedSelection, setSavedSelection] = useState(selectionKey);
  const [versionsSaved, setVersionsSaved] = useState(Boolean(model.versions?.length));
  const [savedHook, setSavedHook] = useState(model.sheet.hook);
  const [pendingHook, setPendingHookState] = useState<string | null>(null);
  const hookDirty = pendingHook !== null && pendingHook.trim() !== savedHook.trim();
  const dirty = text !== base || savedSelection !== selectionKey || hookDirty;
  const textRef = useRef(text);
  useLayoutEffect(() => { textRef.current = text; });
  const hookRef = useRef<string | null>(null);
  const selRef = useRef({ start: 0, end: 0 });
  const historyRef = useRef<History>(emptyHistory);
  const [canStep, setCanStep] = useState({ undo: false, redo: false });
  const syncSteps = () => setCanStep({ undo: historyRef.current.past.length > 0, redo: historyRef.current.future.length > 0 });
  const pendingCaret = useRef<{ start: number; end: number; focus: boolean; restoreScroll: () => void } | null>(null);
  const [applyTick, setApplyTick] = useState(0);
  const setPendingHook = (hook: string | null) => {
    hookRef.current = hook;
    setPendingHookState(hook);
    onPendingHookChange?.(hook);
  };
  const invalidSelection = selection && (selection.platforms.length === 0 || selection.includeChinese && !selection.chinese || Boolean(selection.chinese && (selection.chinese.source !== text || !selection.chinese.content.trim())));
  useDirtyGuard(dirty);

  function currentSnapshot(typing = false): Snapshot {
    const el = textareaRef.current;
    const start = typing || !el ? selRef.current.start : el.selectionStart;
    const end = typing || !el ? selRef.current.end : el.selectionEnd;
    return { text: textRef.current, start, end, hook: hookRef.current };
  }

  /** Every programmatic change: record history, keep the caret and scroll on the same words. */
  function edit(next: string, opts: { selection?: [number, number]; focus?: boolean; hook?: string | null } = {}) {
    const hookChanged = opts.hook !== undefined && opts.hook !== hookRef.current;
    if (next === textRef.current && !hookChanged) return;
    const before = currentSnapshot();
    historyRef.current = pushHistory(historyRef.current, before, 'edit', Date.now());
    const el = textareaRef.current;
    const start = opts.selection?.[0] ?? mapOffset(before.text, next, before.start);
    const end = opts.selection?.[1] ?? mapOffset(before.text, next, before.end);
    pendingCaret.current = { start, end, focus: opts.focus ?? false, restoreScroll: captureScroll(el) };
    selRef.current = { start, end };
    if (hookChanged) setPendingHook(opts.hook ?? null);
    setText(next);
    setApplyTick((n) => n + 1);
    syncSteps();
    if (status.kind === 'saved') setStatus({ kind: 'idle' });
  }

  function travel(direction: 'undo' | 'redo') {
    const current = currentSnapshot();
    const moved = (direction === 'undo' ? undoHistory : redoHistory)(historyRef.current, current);
    if (!moved) return;
    historyRef.current = moved.history;
    const { snapshot } = moved;
    pendingCaret.current = { start: snapshot.start, end: snapshot.end, focus: true, restoreScroll: captureScroll(textareaRef.current) };
    selRef.current = { start: snapshot.start, end: snapshot.end };
    if ((snapshot.hook ?? null) !== hookRef.current) setPendingHook(snapshot.hook ?? null);
    setText(snapshot.text);
    setApplyTick((n) => n + 1);
    syncSteps();
    if (status.kind === 'saved') setStatus({ kind: 'idle' });
  }

  // After the value changed: put the caret back and keep every scroll position, before paint.
  useLayoutEffect(() => {
    const caret = pendingCaret.current;
    const el = textareaRef.current;
    if (!caret || !el) return;
    pendingCaret.current = null;
    if (caret.focus && document.activeElement !== el) el.focus({ preventScroll: true });
    const length = el.value.length;
    el.setSelectionRange(Math.min(caret.start, length), Math.min(caret.end, length));
    caret.restoreScroll();
  }, [applyTick, text]);

  useImperativeHandle(handleRef, () => ({
    setRevision: (revision: string) => setSheetRevision(revision),
    replaceText: (next: string) => edit(next),
    applyHook: (hook: string) => edit(placeHookInText(textRef.current, hook, savedHook).text, { hook: hook.trim() }),
  }));

  // Offer tab-local recovery once, never silently replacing the loaded text.
  useEffect(() => {
    // Deferred: sessionStorage exists only in the browser, after hydration.
    const saved = readRecovery(ns, model.libraryId);
    if (saved && (saved.text !== initialBase || saved.selection && JSON.stringify(saved.selection) !== selectionKey)) queueMicrotask(() => setRestored(saved));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => {
      writeRecovery(ns, { libraryId: model.libraryId, text, base, sheetRevision, sectionHash, selection, savedAt: Date.now() });
    }, 400);
    return () => clearTimeout(t);
  }, [dirty, text, base, sheetRevision, sectionHash, ns, model.libraryId, selection]);

  const markdownOk = model.markdown.state === 'ok';

  useEffect(() => {
    const el = textareaRef.current;
    if (!autoFocus || !el || !canEdit) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(0, 0);
    el.scrollTop = 0;
    // Once on open only; later re-renders must never steal focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    onSnapshot?.({ dirty, sheetRevision, sectionHash, markdownOk, mismatch });
  }, [onSnapshot, dirty, sheetRevision, sectionHash, markdownOk, mismatch]);

  // useDirtyGuard's effect runs first, so guarded navigation sees the committed
  // saved state. Animation frames cannot guarantee React has published it.
  useEffect(() => {
    if (status.kind !== 'saved' || !notifySaved.current) return;
    notifySaved.current = false;
    onSaved?.();
  }, [status, onSaved]);

  async function save() {
    if (!markdownOk) return;
    const ok = await attemptSave();
    if (!ok) onSaveFailed?.();
  }

  /** Runs one save and reports whether it completed; every outcome also sets `status`. */
  async function attemptSave(): Promise<boolean> {
    // Same operation id for a retry of the same text; a new one if the text changed.
    const hookToSave = hookDirty ? pendingHook!.trim() : null;
    const identity = JSON.stringify([text, selection, hookToSave]);
    const op = opRef.current && opRef.current.text === identity ? opRef.current : { id: newOperationId('draft'), text: identity };
    opRef.current = op;
    setStatus({ kind: 'saving' });
    const res = selection ? await (async () => {
      const result = await postJson<MutationResult<PostProperties>>(`/api/library/${encodeURIComponent(model.libraryId)}/versions`, {
        operationId: op.id, expectedRevision: sheetRevision, proposed: text, platforms: selection.platforms, chinese: selection.chinese,
        ...(hookToSave !== null ? { currentHook: hookToSave } : {}),
      });
      if (result.body.ok) return { ...result, body: { ...result.body, value: { record: { revision: result.body.value.revision }, sectionHash: fingerprint(text), driveRevision: '' } } as SaveResponse };
      if (result.body.code === 'STALE_READ') {
        const fresh = await refreshRevisions();
        if (fresh) return { ...result, body: { ...result.body, conflict: { provider: 'db', current: fresh.sheet.draft } } as SaveResponse };
      }
      return { ...result, body: result.body as SaveResponse };
    })() : await postJson<SaveResponse>(`/api/library/${encodeURIComponent(model.libraryId)}/draft`, {
      operationId: op.id,
      expectedSheetRevision: sheetRevision,
      expectedSectionHash: sectionHash,
      proposed: text,
    });
    const body = res.body as SaveResponse;
    if (body.ok) {
      opRef.current = null;
      let savedRevision = body.value.record.revision;
      let hookFailed = false;
      if (hookToSave !== null && !selection) {
        // Sheet mode has no combined write: the hook follows the draft in the same click.
        const hookResult = await postJson<{ ok: boolean; revision?: string }>(`/api/library/${encodeURIComponent(model.libraryId)}/fields`, {
          operationId: newOperationId('hook'), libraryId: model.libraryId, expectedRevision: savedRevision, patch: { currentHook: hookToSave },
        });
        if (hookResult.body.ok && hookResult.body.revision) savedRevision = hookResult.body.revision;
        else hookFailed = true;
      }
      if (hookToSave !== null && !hookFailed) {
        setSavedHook(hookToSave);
        setPendingHook(null);
        onHookSaved?.(hookToSave);
      }
      body.value.record.revision = savedRevision;
      setBase(text);
      setSavedSelection(selectionKey);
      if (selection) setVersionsSaved(true);
      setSheetRevision(body.value.record.revision);
      setSectionHash(body.value.sectionHash);
      clearRecovery(ns, model.libraryId);
      setMismatch(false);
      notifySaved.current = true;
      if (hookFailed) {
        setStatus({ kind: 'error', code: 'PARTIAL_FAILURE', message: 'The draft was saved, but the hook was not. Choose the hook again.' });
        notifySaved.current = false;
        return true;
      }
      setStatus({ kind: 'saved', replayed: body.replayed || body.steps.length > 0 && body.steps.every(s => s.status === 'skipped_already_applied'), refreshPending: body.steps.some(s => s.step === 'refresh_pending') });
      return true;
    }
    if (res.status === 401) {
      setStatus({ kind: 'error', code: 'AUTH_REQUIRED', message: 'You were signed out. Your text is kept in this tab. Sign in again in a new tab, then come back and save.' });
      return false;
    }
    if (body.code === 'STALE_READ' && body.conflict) {
      opRef.current = null;
      setStatus({ kind: 'conflict', provider: body.conflict.provider, current: body.conflict.current });
      return false;
    }
    if (body.code === 'PARTIAL_FAILURE' && body.steps) {
      setStatus({ kind: 'partial', steps: body.steps, operationId: op.id });
      return false;
    }
    if (body.code === 'VALIDATION_FAILED' && body.details?.reason === 'unsafe_markdown_structure') {
      setStatus({
        kind: 'error',
        code: body.code,
        message: 'Not saved: the draft has a heading at the section level (for example "## ...") or an unclosed code fence (```). Either would break the other posts in the master file. Remove it and save again.',
      });
      return false;
    }
    setStatus({ kind: 'error', code: body.code, message: body.message ?? 'The save did not complete. Nothing is confirmed as written; your text is kept here.' });
    return false;
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
    edit(fresh.markdown.body, { hook: null });
    if (selection) {
      const currentSelection = selectionFromSaved(fresh.versions, fresh.targetPlatform);
      onSelectionChange?.(currentSelection);
      setSavedSelection(JSON.stringify(currentSelection));
      setVersionsSaved(Boolean(fresh.versions?.length));
    }
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
              edit(restored.text);
              if (restored.selection) onSelectionChange?.(restored.selection);
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
          {markdownFailure(model.markdown)} Saving is disabled.
        </InlineResult>
      ) : null}

      <label htmlFor={textId} className="text-sm font-medium">
        Post copy <span className="font-normal text-ink-soft">· English</span>
      </label>
      {assist ? <div className="flex flex-col items-start gap-2">{assist}</div> : null}
      <FormatToolbar
        textarea={textareaRef}
        text={text}
        platform={model.targetPlatform}
        disabled={!canEdit}
        onChange={edit}
        canUndo={canStep.undo}
        canRedo={canStep.redo}
        onUndo={() => travel('undo')}
        onRedo={() => travel('redo')}
      />
      <textarea
        ref={textareaRef}
        id={textId}
        value={text}
        onSelect={(e) => { selRef.current = { start: e.currentTarget.selectionStart, end: e.currentTarget.selectionEnd }; }}
        onKeyDown={(e) => {
          if (!canEdit || !(e.ctrlKey || e.metaKey) || e.altKey) return;
          const key = e.key.toLowerCase();
          const direction = key === 'z' ? (e.shiftKey ? 'redo' : 'undo') : key === 'y' && e.ctrlKey ? 'redo' : null;
          if (!direction) return;
          if (direction === 'undo' ? !canStep.undo : !canStep.redo) return;
          e.preventDefault();
          travel(direction);
        }}
        onChange={(e) => {
          const next = e.target.value;
          historyRef.current = pushHistory(historyRef.current, { text: textRef.current, start: selRef.current.start, end: selRef.current.end, hook: hookRef.current }, 'type', Date.now());
          selRef.current = { start: e.target.selectionStart, end: e.target.selectionEnd };
          syncSteps();
          setText(next);
          if (status.kind === 'saved') setStatus({ kind: 'idle' });
        }}
        readOnly={!canEdit || !hydrated}
        spellCheck
        lang="en-GB"
        rows={12}
        className="copy w-full resize-y rounded-md border border-line bg-card p-4 font-sans text-base leading-[1.65]"
      />
      <p className="text-xs text-ink-soft" aria-live="polite">
        {dirty ? 'Unsaved changes' : 'Saved'}
      </p>

      {status.kind === 'saved' ? (
        <InlineResult tone="success">{model.contentProvider === 'db' ? (status.replayed ? 'Already saved in the database.' : 'Saved in the database. Drive export is queued.') : status.replayed ? `Already saved: the Markdown and the ${contentStore} both hold this text.` : `Saved to the master Markdown and mirrored to the ${contentStore}.`}</InlineResult>
      ) : null}
      {(status.kind === 'saved' && status.refreshPending || model.refreshPending) ? <InlineResult tone="warning">Saved in the Sheet. Database refresh pending; your saved text is shown here. Check Fix issues for copy refusals or import lag.</InlineResult> : null}
      {status.kind === 'error' ? <InlineResult tone="error">{status.message}</InlineResult> : null}
      {status.kind === 'partial' ? (
        <RecoveryPanel operationId={status.operationId} steps={status.steps.map((s) => ({ step: s.step, status: s.status, provider: s.provider }))} onRetry={() => void save()} />
      ) : null}

      {saveAsControl}

      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" data-shortcut="save-draft" aria-keyshortcuts="Control+S Meta+S" className={buttonClass('primary')} disabled={!markdownOk || Boolean(invalidSelection) || (!dirty && !mismatch && !(selection && !versionsSaved)) || status.kind === 'saving'} onClick={() => void save()}>
            {status.kind === 'saving' ? 'Saving…' : !dirty && mismatch ? `Make the ${contentStore} match the Markdown` : 'Save draft'}
          </button>
          <button type="button" className={buttonClass()} disabled={!dirty || status.kind === 'saving'} onClick={() => { edit(base, { hook: null }); clearRecovery(ns, model.libraryId); if (savedSelection) onSelectionChange?.(JSON.parse(savedSelection) as SaveSelection); }}>
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
        <p className="text-sm text-ink-soft">Read-only access.</p>
      )}

      {status.kind === 'conflict' ? (
        <ConflictDialog
          open
          onClose={() => setStatus({ kind: 'idle' })}
          title={status.provider === 'drive' ? 'The Markdown section changed after you opened it' : status.provider === 'db' ? 'The database row changed after you opened it' : 'The Sheet row changed after you opened it'}
          description={selection ? 'Nothing was overwritten. Platform selections or Chinese copy may also have changed. Use the current version to load those saved versions, or keep your English and platform versions to review again.' : 'Nothing was overwritten. Compare the three versions, then choose. Your edit stays in this tab either way.'}
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
