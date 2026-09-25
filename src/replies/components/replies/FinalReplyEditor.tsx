'use client';

import { useRef } from 'react';
import { Button, Card, Meta, ReplyText, SectionHeading, StatusLine } from './primitives';
import { FormatToolbar } from './FormatToolbar';
import { EDITOR, MEANING } from '@/replies/lib/workspace/copy';
import { needsEnglishMeaning, type Platform } from '@/replies/lib/contracts/vocabulary';
import type { MeaningState, ProposalState } from '@/replies/lib/workspace/reducer';

/**
 * The final editor (D08, D09).
 *
 * It is always usable. During a generation outage, during a translation, while a
 * rewrite is being previewed: the textarea keeps accepting keystrokes, because the
 * owner's fallback for every failure in this product is to write the reply
 * themselves, and disabling the box removes the fallback exactly when it is needed.
 *
 * A proposal is rendered beside the editor, never into it. The two buttons say what
 * they do to the owner's text: Replace reply, or Keep my reply.
 */

export interface FinalReplyEditorProps {
  platform: Platform;
  draft: string;
  proposal: ProposalState | null;
  meaning: MeaningState;
  canUndo: boolean;
  hasInsertedResource: boolean;
  canAddPersonalExample: boolean;
  refining: boolean;
  /** Shown when a rewrite was refused or failed, so a dead press is explained. */
  notice: string | null;
  onChange(value: string): void;
  onRefine(action: 'shorter' | 'more_direct' | 'warmer' | 'add_personal_example'): void;
  onAcceptProposal(): void;
  onRejectProposal(): void;
  onRemoveResource(): void;
  onUndo(): void;
  onRefreshMeaning(): void;
}

/**
 * A stable id, not a generated one.
 *
 * When the clipboard refuses, the action strip has to select the text so the
 * owner can copy it with the keyboard. It needs to find this exact textarea: a
 * generated id would leave it selecting the whole section, labels included, and
 * the owner would paste the interface into their feed.
 */
export const FINAL_EDITOR_ID = 'final-reply-editor';

export function FinalReplyEditor(props: FinalReplyEditorProps) {
  const editorId = FINAL_EDITOR_ID;
  const composing = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chinese = needsEnglishMeaning(props.platform);

  return (
    <section aria-labelledby="editor-heading" className="mb-4" id="your-reply">
      <SectionHeading id="editor-heading">{EDITOR.heading}</SectionHeading>

      <FormatToolbar textarea={textareaRef} text={props.draft} platform={props.platform} onChange={props.onChange} />

      <label htmlFor={editorId} className="sr-only">
        {EDITOR.label}
      </label>
      <textarea
        ref={textareaRef}
        id={editorId}
        value={props.draft}
        placeholder={EDITOR.placeholder}
        onChange={(event) => props.onChange(event.target.value)}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
        rows={8}
        lang={chinese ? 'zh-TW' : 'en'}
        className={`w-full resize-y rounded-md border border-border-input bg-card p-3 text-reply ${
          chinese ? 'sr-cjk' : 'leading-relaxed'
        }`}
      />

      <div className="mt-2 flex flex-wrap gap-2">
        <Button onClick={() => props.onRefine('shorter')} disabled={props.refining}>
          {EDITOR.shorter}
        </Button>
        <Button onClick={() => props.onRefine('more_direct')} disabled={props.refining}>
          {EDITOR.moreDirect}
        </Button>
        <Button onClick={() => props.onRefine('warmer')} disabled={props.refining}>
          {EDITOR.warmer}
        </Button>
        {/* Visible only when an eligible approved fact actually exists (D08). */}
        {props.canAddPersonalExample ? (
          <Button onClick={() => props.onRefine('add_personal_example')} disabled={props.refining}>
            {EDITOR.addExample}
          </Button>
        ) : null}
        {props.hasInsertedResource ? (
          <Button variant="quiet" onClick={props.onRemoveResource}>
            {EDITOR.removeResource}
          </Button>
        ) : null}
        {props.canUndo ? (
          <Button variant="quiet" onClick={props.onUndo}>
            {EDITOR.undo}
          </Button>
        ) : null}
      </div>

      {props.notice ? <StatusLine tone="error">{props.notice}</StatusLine> : null}

      {props.proposal ? (
        <Card className="mt-3 border-green bg-green-soft">
          <StatusLine>{EDITOR.rewriteReady}</StatusLine>
          <ReplyText text={props.proposal.text} chinese={chinese} className="mt-2" />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="primary" onClick={props.onAcceptProposal}>
              {props.proposal.origin === 'idea' ? EDITOR.replaceReply : EDITOR.applyRewrite}
            </Button>
            <Button onClick={props.onRejectProposal}>{EDITOR.keepMine}</Button>
          </div>
        </Card>
      ) : null}

      {chinese ? (
        <div className="mt-3 border-t border-hairline pt-3">
          <h3 className="mb-1 text-meta font-semibold">{MEANING.heading}</h3>

          {props.meaning.status === 'loading' ? <StatusLine>{MEANING.loading}</StatusLine> : null}

          {props.meaning.status === 'stale' ? (
            <div>
              <StatusLine>{MEANING.stale}</StatusLine>
              <Button className="mt-1" onClick={props.onRefreshMeaning}>
                {MEANING.refresh}
              </Button>
            </div>
          ) : null}

          {props.meaning.status === 'failed' ? (
            <div>
              <StatusLine tone="error">{MEANING.failed}</StatusLine>
              <Button className="mt-1" onClick={props.onRefreshMeaning}>
                {MEANING.refresh}
              </Button>
            </div>
          ) : null}

          {props.meaning.status === 'ready' && props.meaning.text ? (
            <Meta>{props.meaning.text}</Meta>
          ) : null}

          {props.meaning.status === 'idle' ? (
            <Button onClick={props.onRefreshMeaning}>{MEANING.refresh}</Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

