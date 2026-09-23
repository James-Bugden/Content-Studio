'use client';

import { useCallback, useRef, useState } from 'react';
import { isAnyDirty } from './dirty-store';
import { ModalDialog } from './modal-dialog';
import { buttonClass } from './button-styles';

/**
 * Explicit choice before an in-app navigation discards unsaved edits (UX-04).
 *
 * `guard(proceed)` runs `proceed` straight away when nothing is dirty, and
 * otherwise opens a dialog whose safe default is "Stay and keep editing". The
 * returned `dialog` element must be rendered by the caller.
 */
export function useLeaveConfirmation(): { guard: (proceed: () => void) => void; dialog: React.ReactNode } {
  const [open, setOpen] = useState(false);
  const pending = useRef<(() => void) | null>(null);

  const guard = useCallback((proceed: () => void) => {
    if (!isAnyDirty()) {
      proceed();
      return;
    }
    pending.current = proceed;
    setOpen(true);
  }, []);

  const stay = useCallback(() => {
    pending.current = null;
    setOpen(false);
  }, []);

  const leave = useCallback(() => {
    const proceed = pending.current;
    pending.current = null;
    setOpen(false);
    proceed?.();
  }, []);

  const dialog = (
    <ModalDialog
      open={open}
      onClose={stay}
      tone="warning"
      title="Leave without saving?"
      description="You have unsaved changes in the editor. Nothing has been saved yet. Leaving now discards those changes."
      footer={
        <>
          <button type="button" className={buttonClass('danger')} onClick={leave}>
            Leave and discard changes
          </button>
          <button type="button" className={buttonClass('primary')} onClick={stay} autoFocus>
            Stay and keep editing
          </button>
        </>
      }
    />
  );

  return { guard, dialog };
}
