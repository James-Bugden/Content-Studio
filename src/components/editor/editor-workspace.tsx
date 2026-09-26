'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { EditorModel } from '@/domain/views';
import { InlineResult } from '../inline-result';
import { HookPanel } from './hook-panel';
import { initialEditorText, PostEditor, type EditorSnapshot } from './post-editor';
import { QaPanel } from './qa-panel';

/**
 * Owns the editor's current text so the AI panels always bind to exactly what is
 * in the textarea (CS-009/CS-010). The Post Editor keeps its own save, recovery and
 * conflict behaviour; after a hook choice the whole editor reloads from the
 * authoritative model so the hook and the draft stay in step.
 */
export function EditorWorkspace({ model: initialModel, canEdit, ns, focusMode = false }: { model: EditorModel; canEdit: boolean; ns: string; focusMode?: boolean }) {
  const router = useRouter();
  const [model, setModel] = useState(initialModel);
  const [text, setText] = useState(() => initialEditorText(initialModel));
  const [editorKey, setEditorKey] = useState(0);
  const [snapshot, setSnapshot] = useState<EditorSnapshot>({
    dirty: false,
    sheetRevision: initialModel.sheet.revision,
    sectionHash: initialModel.markdown.state === 'ok' ? initialModel.markdown.sectionHash : '',
    markdownOk: initialModel.markdown.state === 'ok',
  });
  const [reloadFailed, setReloadFailed] = useState(false);
  const onSnapshot = useCallback((s: EditorSnapshot) => setSnapshot(s), []);

  async function reload() {
    try {
      const res = await fetch(`/api/library/${encodeURIComponent(model.libraryId)}/editor`, { credentials: 'same-origin', cache: 'no-store' });
      const body = (await res.json()) as { ok: boolean; model?: EditorModel };
      if (!res.ok || !body.ok || !body.model) throw new Error('reload');
      setModel(body.model);
      setText(initialEditorText(body.model));
      setEditorKey((k) => k + 1);
      setReloadFailed(false);
      router.refresh();
    } catch {
      setReloadFailed(true);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PostEditor key={editorKey} model={model} canEdit={canEdit} ns={ns} value={text} onValueChange={setText} onSnapshot={onSnapshot} />
      {reloadFailed ? <InlineResult tone="warning">The change was saved, but the editor could not reload it. Reload the page to see the latest version.</InlineResult> : null}
      {focusMode ? <details className="rounded-lg border border-line bg-card p-3"><summary className="cursor-pointer font-medium">English check</summary><div className="mt-3"><QaPanel libraryId={model.libraryId} text={text} canEdit={canEdit} onApply={setText} /></div></details>
        : <QaPanel libraryId={model.libraryId} text={text} canEdit={canEdit} onApply={setText} />}
      {focusMode ? <details className="rounded-lg border border-line bg-card p-3"><summary className="cursor-pointer font-medium">Hook review</summary><div className="mt-3">{hookPanel()}</div></details> : hookPanel()}
    </div>
  );

  function hookPanel() {
    return <HookPanel
        libraryId={model.libraryId}
        platform={model.targetPlatform}
        currentHook={model.sheet.hook}
        text={text}
        dirty={snapshot.dirty}
        markdownOk={snapshot.markdownOk}
        sheetRevision={snapshot.sheetRevision}
        sectionHash={snapshot.sectionHash}
        canEdit={canEdit}
        onChanged={reload}
      />;
  }
}
