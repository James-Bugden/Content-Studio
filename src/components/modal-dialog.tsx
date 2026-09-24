'use client';

import { useEffect, useId, useRef } from 'react';

/**
 * Thin wrapper over the native <dialog> (CS-006, UX-01).
 *
 * showModal() gives us the focus trap, inert background and Escape handling for
 * free, so no hand-rolled focus trap can drift out of spec. We still remember the
 * element that opened the dialog and put focus back on it, because not every
 * browser restores focus on close. Environments without showModal (jsdom) fall
 * back to the `open` attribute so behaviour stays testable.
 */
export type ModalDialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  /** Wider layout for side-by-side comparisons. */
  wide?: boolean;
  /** Visually distinguishes a warning from a plain decision. */
  tone?: 'neutral' | 'warning';
};

export function ModalDialog({ open, onClose, title, description, children, footer, wide = false, tone = 'neutral' }: ModalDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    } else if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
      returnFocus.current?.focus();
      returnFocus.current = null;
    }
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    // Native Escape fires `cancel`; keep React state in charge of open/closed.
    const onCancel = (event: Event) => {
      event.preventDefault();
      onClose();
    };
    dialog.addEventListener('cancel', onCancel);
    return () => dialog.removeEventListener('cancel', onCancel);
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onKeyDown={(event) => {
        // jsdom has no native cancel; real browsers already handled it above.
        if (event.key === 'Escape' && typeof ref.current?.showModal !== 'function') onClose();
      }}
      className={[
        'm-auto w-[calc(100%-2rem)] rounded-lg border bg-card p-0 text-ink shadow-xl backdrop:bg-ink/40',
        wide ? 'max-w-6xl' : 'max-w-lg',
        tone === 'warning' ? 'border-block border-t-4' : 'border-line',
      ].join(' ')}
    >
      {open ? (
        <div className="flex max-h-[85vh] flex-col">
          <div className="border-b border-line px-5 py-4">
            <h2 id={titleId} className="text-lg font-semibold">
              {title}
            </h2>
            {description ? (
              <div id={descId} className="mt-1 text-sm text-ink-soft">
                {description}
              </div>
            ) : null}
          </div>
          {children ? (
            // Focusable so keyboard users can scroll long comparisons at phone width.
            <div role="region" aria-labelledby={titleId} tabIndex={0} className="min-h-0 flex-1 overflow-auto px-5 py-4">
              {children}
            </div>
          ) : null}
          {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div> : null}
        </div>
      ) : null}
    </dialog>
  );
}
