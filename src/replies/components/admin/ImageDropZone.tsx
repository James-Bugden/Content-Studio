'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type DragEvent, type KeyboardEvent } from 'react';
import { BANK_ADMIN } from '@/replies/lib/workspace/copy';

/**
 * The upload zone for the image bank (#246).
 *
 * One big target that takes files three ways: click or Enter/Space to open the
 * picker, drag and drop, and paste (Ctrl/Cmd+V of an image anywhere on the page).
 * The real file input sits beside the zone, not inside it, so the zone is the one
 * interactive control for a keyboard or screen reader user.
 *
 * It only hands files up. Validation and upload stay in the parent.
 */

export interface ImageDropZoneProps {
  onFiles(files: File[]): void;
}

function UploadIcon() {
  return (
    <svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 16V4" />
      <path d="m7 9 5-5 5 5" />
      <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
    </svg>
  );
}

const COARSE = '(pointer: coarse)';
const coarseNow = () => typeof window.matchMedia === 'function' && window.matchMedia(COARSE).matches;
function subscribeCoarse(notify: () => void) {
  if (typeof window.matchMedia !== 'function') return () => {};
  const query = window.matchMedia(COARSE);
  query.addEventListener?.('change', notify);
  return () => query.removeEventListener?.('change', notify);
}

export function ImageDropZone({ onFiles }: ImageDropZoneProps) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const touch = useSyncExternalStore(subscribeCoarse, coarseNow, () => false);

  // Paste works anywhere on the page, not only while the zone has focus.
  useEffect(() => {
    function onPaste(event: ClipboardEvent) {
      const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith('image/'));
      if (files.length === 0) return;
      event.preventDefault();
      onFiles(files);
    }
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [onFiles]);

  function openPicker() {
    input.current?.click();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openPicker();
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length > 0) onFiles(files);
  }

  return (
    <div className="min-w-0 flex-1">
      <div
        role="button"
        tabIndex={0}
        onClick={openPicker}
        onKeyDown={onKeyDown}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={onDrop}
        data-dragging={dragging ? 'true' : 'false'}
        className={[
          'flex min-h-32 w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-6 text-center',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
          dragging ? 'border-primary bg-paper-alt text-ink' : 'border-border-input bg-card text-ink-soft hover:bg-paper-alt',
        ].join(' ')}
      >
        <UploadIcon />
        <span className="text-[0.9375rem] font-medium text-ink">
          {dragging ? BANK_ADMIN.dropActive : touch ? BANK_ADMIN.dropTitleTouch : BANK_ADMIN.dropTitle}
        </span>
        <span className="text-meta">{BANK_ADMIN.dropHint}</span>
      </div>
      <input
        ref={input}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp"
        aria-label={BANK_ADMIN.filesInput}
        tabIndex={-1}
        className="sr-only"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          // Reset so choosing the same file again still fires a change.
          event.target.value = '';
          if (files.length > 0) onFiles(files);
        }}
      />
    </div>
  );
}
