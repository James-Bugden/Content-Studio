'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, Meta, StatusLine } from './primitives';
import { RECORD } from '@/replies/lib/workspace/copy';
import { PLATFORM_LABELS, type Platform } from '@/replies/lib/contracts/vocabulary';
import type { SaveState } from '@/replies/lib/workspace/reducer';

/**
 * Copy and Mark posted (D10, COPY-01).
 *
 * Copy waits for `writeText` to resolve before it says "Copied". A button that
 * claims success and leaves an empty clipboard is worse than one that admits it
 * could not: the owner pastes nothing into their feed and only finds out there.
 * When the write is refused, the editor text is selected so the owner can copy it
 * with the keyboard, and the counter does not move, because copying is not posting.
 *
 * This is the one element allowed to stick to the bottom (D01), and it reserves its
 * own measured height so nothing it covers becomes unreachable. At short viewport
 * heights it returns to the document flow, where virtual-keyboard behaviour is
 * predictable.
 */

export interface ActionStripProps {
  platform: Platform;
  draft: string;
  save: SaveState;
  editedSinceCopy: boolean;
  /** The element holding the text, used to select it when the clipboard refuses. */
  selectTargetId: string;
  onCopied(): void;
  onMarkPosted(): void;
  onUndoRecorded(): void;
  ideaSave: 'idle' | 'saving' | 'saved' | 'failed';
  onSaveAsContentIdea(): void;
  onNextReply(): void;
}

function selectTextIn(elementId: string) {
  const element = document.getElementById(elementId);
  if (element instanceof HTMLTextAreaElement) {
    element.focus();
    element.select();
    return;
  }
  if (element) {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
}

export function ActionStrip(props: ActionStripProps) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const stripRef = useRef<HTMLDivElement>(null);
  const [floating, setFloating] = useState(false);

  useEffect(() => {
    function measure() {
      const height = stripRef.current?.offsetHeight ?? 0;
      document.documentElement.style.setProperty('--sr-action-strip-height', `${height}px`);
      // Below this height the on-screen keyboard leaves too little room for a
      // pinned strip to be anything but an obstruction.
      setFloating(window.innerHeight >= 640);
    }
    measure();

    // The strip changes height when it swaps to the saved state, and again when a
    // failure message appears. Measuring only on resize would leave the reserved
    // space stale and let the strip cover the end of the reply, which is exactly
    // the content the owner is trying to read at that moment.
    const observer = new ResizeObserver(measure);
    if (stripRef.current) observer.observe(stripRef.current);
    window.addEventListener('resize', measure);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(props.draft);
      setCopyState('copied');
      props.onCopied();
    } catch {
      // Never claim success, and never read the clipboard to check.
      setCopyState('failed');
      selectTextIn(props.selectTargetId);
    }
  }

  const saving = props.save.status === 'saving';
  const saved = props.save.status === 'saved';

  return (
    <div
      ref={stripRef}
      data-strip="action"
      className={
        floating
          ? 'sticky bottom-0 z-10 border-t border-hairline bg-paper/95 px-4 py-3 backdrop-blur'
          : 'border-t border-hairline bg-paper px-4 py-3'
      }
    >
      {saved && props.save.status === 'saved' ? (
        <div>
          <StatusLine>
            {RECORD.saved(
              PLATFORM_LABELS[props.platform],
              props.save.progress.counts[props.platform],
              props.save.progress.targets[props.platform],
            )}
          </StatusLine>
          {props.save.status === 'saved' && props.save.undoFailed ? (
            <StatusLine tone="error">{RECORD.undoFailed}</StatusLine>
          ) : null}
          {props.ideaSave === 'saved' ? <StatusLine>{RECORD.ideaSaved}</StatusLine> : null}
          {props.ideaSave === 'failed' ? (
            <StatusLine tone="error">{RECORD.ideaFailed}</StatusLine>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-2">
            <Button onClick={props.onUndoRecorded}>{RECORD.undoRecorded}</Button>
            <Button
              variant="secondary"
              onClick={props.onSaveAsContentIdea}
              disabled={props.ideaSave === 'saving' || props.ideaSave === 'saved'}
            >
              {props.ideaSave === 'saving' ? RECORD.savingIdea : RECORD.saveAsIdea}
            </Button>
            <Button variant="primary" size="primary" onClick={props.onNextReply}>
              {RECORD.next}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="primary" onClick={copy} disabled={props.draft.trim() === ''}>
              {copyState === 'copied' ? RECORD.copied : RECORD.copy}
            </Button>
            <Button
              variant="primary"
              size="primary"
              onClick={props.onMarkPosted}
              disabled={saving || props.draft.trim() === ''}
            >
              {saving ? RECORD.saving : RECORD.markPosted}
            </Button>
            {props.editedSinceCopy ? <Meta>{RECORD.editedSinceCopy}</Meta> : null}
          </div>

          {copyState === 'failed' ? <StatusLine tone="error">{RECORD.copyFailed}</StatusLine> : null}

          {props.save.status === 'failed' ? (
            <div className="mt-1">
              <StatusLine tone="error">{RECORD.saveFailed}</StatusLine>
              <Button className="mt-1" onClick={props.onMarkPosted}>
                {RECORD.retrySave}
              </Button>
            </div>
          ) : (
            <Meta className="mt-1">
              {RECORD.helper} {props.editedSinceCopy ? RECORD.helperEdited : ''}
            </Meta>
          )}
        </>
      )}
    </div>
  );
}
