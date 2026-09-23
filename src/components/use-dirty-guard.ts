'use client';

import { useCallback, useEffect, useId, useSyncExternalStore } from 'react';
import { isAnyDirty, serverSnapshot, setDirty, subscribeDirty } from './dirty-store';

/**
 * Protects an editor's unsaved changes (CS-006, UX-04).
 *
 * While `isDirty` is true the browser asks before a reload, tab close or external
 * navigation (`beforeunload`), and every GuardedLink / FilterBar in the app asks
 * through an explicit dialog before an in-app navigation.
 *
 * `confirmLeave()` is synchronous: it returns true when leaving is safe right now
 * (no editor is dirty) and false when the caller must not navigate without asking.
 * Use GuardedLink, or `useLeaveConfirmation`, to do the asking; a synchronous
 * window.confirm is deliberately not used.
 */
export function useDirtyGuard(isDirty: boolean): { isDirty: boolean; confirmLeave: () => boolean } {
  const id = useId();

  useEffect(() => {
    setDirty(id, isDirty);
    return () => setDirty(id, false);
  }, [id, isDirty]);

  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Legacy browsers only show the prompt when returnValue is set.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isDirty]);

  const confirmLeave = useCallback(() => !isAnyDirty(), []);
  return { isDirty, confirmLeave };
}

/** True while any mounted editor holds unsaved changes. */
export function useAnyDirty(): boolean {
  return useSyncExternalStore(subscribeDirty, isAnyDirty, serverSnapshot);
}
