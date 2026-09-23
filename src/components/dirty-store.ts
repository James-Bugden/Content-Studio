/**
 * Process-wide record of which editors hold unsaved changes (CS-006, UX-04).
 *
 * The shell's navigation and the filter bar live far from the editor in the tree,
 * so a React context would force every page to thread a provider through. A tiny
 * external store read with useSyncExternalStore keeps the guard honest everywhere:
 * any mounted editor that reports dirty makes every guarded control ask first.
 * Only booleans are stored, never copy.
 */
const dirty = new Set<string>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function setDirty(id: string, isDirty: boolean): void {
  const had = dirty.has(id);
  if (isDirty && !had) dirty.add(id);
  else if (!isDirty && had) dirty.delete(id);
  else return;
  emit();
}

export function isAnyDirty(): boolean {
  return dirty.size > 0;
}

export function subscribeDirty(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Server render never has a dirty editor. */
export function serverSnapshot(): boolean {
  return false;
}

/** Test-only reset so one test's editor cannot leak into the next. */
export function resetDirtyStoreForTests(): void {
  dirty.clear();
  emit();
}
