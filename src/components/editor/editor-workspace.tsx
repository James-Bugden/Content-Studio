'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { EditorModel } from '@/domain/views';
import { InlineResult } from '../inline-result';
import { HookPanel } from './hook-panel';
import { initialEditorText, PostEditor, type EditorSnapshot } from './post-editor';
import { QaPanel } from './qa-panel';
import { ReviewActions } from '../review/review-actions';
import { LibraryPestoField } from '../backlog/library-pesto-field';
import { HookChoice } from './hook-choice';
import { MismatchNotice } from './mismatch-notice';
import { SAVE_PLATFORMS, savedSelection, type SavePlatform, type SaveSelection } from '@/domain/post-versions';
import { PlatformPreview } from '../panel/platform-preview';
import { PlatformLogo } from '../panel/platform-logo';
import { SaveAs } from './save-as';
import { DeletePost } from './delete-post';
import { GuardedLink } from '../guarded-link';
import { ReviewChecks } from './review-checks';
import { PanelImage } from '../visuals/panel-image';
import { isAnyDirty } from '../dirty-store';

/**
 * Owns the editor's current text so the AI panels always bind to exactly what is
 * in the textarea (CS-009/CS-010). The Post Editor keeps its own save, recovery and
 * conflict behaviour; after a hook choice the whole editor reloads from the
 * authoritative model so the hook and the draft stay in step.
 */
export function EditorWorkspace({ model: initialModel, canEdit, ns, focusMode = false, reviewActions = false, inlineImage = false, onSaved, onSaveFailed, onReviewed }: {
  inlineImage?: boolean;
  model: EditorModel; canEdit: boolean; ns: string; focusMode?: boolean;
  /** Show Approve / Request changes under the editor (CS-049). Owners only. */
  reviewActions?: boolean;
  /** After a successful review transition; the editor itself reloads its model. */
  onReviewed?: (message: string) => void;
  /** Focus mode only: replaces the default page refresh after a save (the Backlog defers it to close, CS-047). */
  onSaved?: () => void;
  onSaveFailed?: () => void;
}) {
  const router = useRouter();
  const contentStore = initialModel.contentProvider === 'db' ? 'database' : 'Sheet';
  const [model, setModel] = useState(initialModel);
  const [text, setText] = useState(() => initialEditorText(initialModel));
  const [reviewRevision, setReviewRevision] = useState<string>();
  const [editorKey, setEditorKey] = useState(0);
  const [selection, setSelection] = useState<SaveSelection>(() => savedSelection(initialModel.versions, initialModel.targetPlatform, initialEditorText(initialModel)));
  const [previewPlatform, setPreviewPlatform] = useState<SavePlatform>(SAVE_PLATFORMS.includes(initialModel.targetPlatform as SavePlatform) ? initialModel.targetPlatform as SavePlatform : 'LinkedIn');
  const [previewChinese, setPreviewChinese] = useState(false);
  const [aiOpen, setAiOpen] = useState(true);
  const aiRef = useRef<HTMLDivElement>(null);
  const [snapshot, setSnapshot] = useState<EditorSnapshot>({
    dirty: false,
    sheetRevision: initialModel.sheet.revision,
    sectionHash: initialModel.markdown.state === 'ok' ? initialModel.markdown.sectionHash : '',
    markdownOk: initialModel.markdown.state === 'ok',
    mismatch: initialModel.mismatch,
  });
  const [reloadFailed, setReloadFailed] = useState(false);
  const snapshotRef = useRef(snapshot);
  const onSnapshot = useCallback((s: EditorSnapshot) => { snapshotRef.current = s; setSnapshot(s); }, []);

  const reload = useCallback(async (refreshPage = true) => {
    try {
      const res = await fetch(`/api/library/${encodeURIComponent(model.libraryId)}/editor`, { credentials: 'same-origin', cache: 'no-store' });
      const body = (await res.json()) as { ok: boolean; model?: EditorModel };
      if (!res.ok || !body.ok || !body.model) throw new Error('reload');
      setModel(body.model);
      if (!snapshotRef.current.dirty) {
        setText(initialEditorText(body.model));
        setSelection(savedSelection(body.model.versions, body.model.targetPlatform, initialEditorText(body.model)));
        setEditorKey((k) => k + 1);
      }
      setReloadFailed(false);
      if (refreshPage) router.refresh();
    } catch {
      setReloadFailed(true);
    }
  }, [model.libraryId, router]);

  useEffect(() => {
    const imageChanged = (event: Event) => {
      if ((event as CustomEvent<{ libraryId: string }>).detail?.libraryId === model.libraryId && !snapshot.dirty) void reload(false);
    };
    window.addEventListener('cs:post-image-changed', imageChanged);
    return () => window.removeEventListener('cs:post-image-changed', imageChanged);
  }, [model.libraryId, snapshot.dirty, reload]);

  async function refreshSavedMetadata() {
    const res = await fetch(`/api/library/${encodeURIComponent(model.libraryId)}/editor`, { credentials: 'same-origin', cache: 'no-store' }).catch(() => null);
    const body = await res?.json().catch(() => null) as { ok: boolean; model?: EditorModel } | null;
    if (res?.ok && body?.ok && body.model && body.model.sheet.revision === snapshotRef.current.sheetRevision) {
      // Keep the mounted editor and any typing after Save; refresh gates only.
      const fresh = body.model;
      setModel(m => ({ ...m, gates: fresh.gates, reviewStatus: fresh.reviewStatus }));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* CS-054: PESTO beside the copy. It writes the Sheet row, so it waits for
          unsaved copy to be saved (the save is checked against the row revision),
          then reloads the editor onto the new revision. */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-ink-soft">PESTO</span>
        <LibraryPestoField
          key={`${model.sheet.revision}:${model.pesto}`}
          libraryId={model.libraryId}
          value={model.pesto}
          revision={snapshot.sheetRevision}
          canEdit={canEdit && !snapshot.dirty}
          suggestions={model.pestoOptions}
          onSaved={() => {
            void reload(!focusMode);
            if (focusMode) onSaved?.();
          }}
        />
        {canEdit && snapshot.dirty ? <span className="text-xs text-ink-soft">Save the draft first to change PESTO.</span> : null}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
        <span className="text-sm font-semibold">English master</span>
        <div className="flex items-center gap-3 text-sm">
          {inlineImage ? <a href="#panel-image" className="inline-flex min-h-11 items-center underline">Image</a> : <GuardedLink href={`/visuals/${encodeURIComponent(model.libraryId)}`} className="inline-flex min-h-11 items-center underline">Image</GuardedLink>}
          <button type="button" aria-expanded={aiOpen} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-ink px-3 font-semibold" onClick={() => { setAiOpen(v => !v); if (!aiOpen) requestAnimationFrame(() => aiRef.current?.scrollIntoView({ block: 'nearest' })); }}><span aria-hidden="true">✧</span> AI</button>
        </div>
      </div>
      <div className="grid min-w-0 gap-5 min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
        <div className="min-w-0">
          <PostEditor key={editorKey} externalRevision={reviewRevision} model={model} canEdit={canEdit} ns={ns} value={text} onValueChange={setText} onSnapshot={onSnapshot} onSaved={() => { void refreshSavedMetadata(); if (onSaved) onSaved(); else if (focusMode) router.refresh(); }} onSaveFailed={onSaveFailed} autoFocus={focusMode}
            selection={model.contentProvider === 'db' ? selection : undefined}
            onSelectionChange={setSelection}
            saveAsControl={model.contentProvider === 'db' ? <SaveAs libraryId={model.libraryId} text={text} value={selection} onChange={setSelection} canEdit={canEdit} /> : undefined} />
          {model.contentProvider === 'db' && canEdit ? <DeletePost libraryId={model.libraryId} revision={snapshot.sheetRevision} disabled={snapshot.dirty} /> : null}
        </div>
        <aside aria-label="Platform preview" className="min-w-0 min-[1100px]:sticky min-[1100px]:top-0 min-[1100px]:self-start">
          <div className="mb-3 flex flex-wrap items-center gap-1" role="group" aria-label="Preview platform">
            {SAVE_PLATFORMS.map(platform => <button key={platform} type="button" aria-label={`Preview ${platform}`} aria-pressed={previewPlatform === platform} onClick={() => setPreviewPlatform(platform)} className={`flex min-h-11 items-center gap-1.5 rounded-md px-2 text-xs ${previewPlatform === platform ? 'bg-primary-soft font-semibold' : 'text-ink-soft'}`}><PlatformLogo platform={platform} />{platform}</button>)}
          </div>
          {selection.chinese && selection.chinese.source === text ? <label className="mb-2 flex min-h-11 items-center gap-2 text-xs"><input type="checkbox" checked={previewChinese} onChange={e => setPreviewChinese(e.target.checked)} />Preview Chinese</label> : null}
          <PlatformPreview key={previewPlatform} platform={previewPlatform} text={previewChinese && selection.chinese?.source === text ? selection.chinese.content : text} thumb={model.thumb ?? null} language={previewChinese && selection.chinese?.source === text ? 'zh-Hant-TW' : 'en-GB'} />
          <p className="mt-2 text-xs text-ink-soft">Preview · saved versions remain drafts until reviewed.</p>
        </aside>
      </div>
      {reviewActions && canEdit ? (
        <ReviewActions
          imageHref={inlineImage ? '#panel-image' : `/visuals/${encodeURIComponent(model.libraryId)}`}
          onShowQa={() => {
            setAiOpen(true);
            requestAnimationFrame(() => {
              aiRef.current?.querySelectorAll('details').forEach(el => { el.open = true; });
              aiRef.current?.scrollIntoView({ block: 'start' });
            });
          }}
          libraryId={model.libraryId}
          reviewStatus={model.reviewStatus}
          blockers={model.gates.blockers}
          sheetRevision={snapshot.sheetRevision}
          dirty={snapshot.dirty}
          onDone={(card, message) => {
            if (snapshotRef.current.dirty || isAnyDirty()) {
              // Request changes changes review metadata only. Retain the local copy and
              // advance the save precondition to the revision returned by the mutation.
              setReviewRevision(card.revision);
              setModel(m => ({ ...m, reviewStatus: card.reviewStatus, gates: card.gates }));
            } else {
              void reload(!onReviewed);
              onReviewed?.(message);
            }
          }}
        />
      ) : null}
      {reloadFailed ? <InlineResult tone="warning">The change was saved, but the editor could not reload it. Reload the page to see the latest version.</InlineResult> : null}
      {inlineImage && model.visualItem ? <PanelImage key={model.visualItem.revision} initial={model.visualItem} imageBrief={model.imageBrief} canEdit={canEdit} copyDirty={snapshot.dirty} onChanged={() => { void reload(!onReviewed); onReviewed?.('Image saved.'); }} /> : null}
      <div id={`qa-${model.libraryId}`} ref={aiRef} hidden={!aiOpen} className="space-y-4">
      {canEdit ? <ReviewChecks model={model} revision={snapshot.sheetRevision} disabled={snapshot.dirty} onSaved={() => { void reload(!onReviewed); onReviewed?.('QA decision saved.'); }} /> : null}
      <HookChoice
        key={`hook:${model.sheet.revision}`}
        libraryId={model.libraryId}
        contentStore={contentStore}
        alternatives={model.hookAlternatives}
        currentHook={model.sheet.hook}
        revision={snapshot.sheetRevision}
        canEdit={canEdit}
        blockedReason={snapshot.dirty ? `Save the draft first; the hook saves to the same ${contentStore} row.` : undefined}
        onSaved={() => {
          void reload(!focusMode);
          if (focusMode) onSaved?.();
        }}
      />
      {focusMode ? <details className="rounded-lg border border-line bg-card p-3"><summary className="cursor-pointer font-medium">English check</summary><div className="mt-3"><QaPanel libraryId={model.libraryId} text={text} canEdit={canEdit} onApply={setText} /></div></details>
        : <QaPanel libraryId={model.libraryId} text={text} canEdit={canEdit} onApply={setText} />}
      {focusMode ? <details className="rounded-lg border border-line bg-card p-3"><summary className="cursor-pointer font-medium">Hook review</summary><div className="mt-3">{hookPanel()}</div></details> : hookPanel()}
      </div>
      {snapshot.mismatch ? <MismatchNotice contentStore={contentStore} sheetDraft={model.sheet.draft} canEdit={canEdit} onUseSheetVersion={() => setText(model.sheet.draft)} /> : null}
    </div>
  );

  function hookPanel() {
    return <HookPanel
        contentStore={contentStore}
        libraryId={model.libraryId}
        platform={model.targetPlatform}
        currentHook={model.sheet.hook}
        text={text}
        dirty={snapshot.dirty}
        markdownOk={snapshot.markdownOk}
        sheetRevision={snapshot.sheetRevision}
        sectionHash={snapshot.sectionHash}
        canEdit={canEdit}
        onChanged={() => void reload()}
      />;
  }
}
