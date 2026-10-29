/**
 * History mode for URL-backed view state (#247). A first change pushes an entry so
 * Back returns to the previous view; changes that follow within a short window
 * (rapid chip clicks, flipping sort) replace it so Back is not a stack of
 * half-finished states.
 */
export const RAPID_CHANGE_MS = 1500;

export function historyMode(lastChangeAt: number, now: number, windowMs = RAPID_CHANGE_MS): 'push' | 'replace' {
  return lastChangeAt > 0 && now - lastChangeAt < windowMs ? 'replace' : 'push';
}

let lastChange = 0;

/** Mode for the next URL-state change; records the change time. */
export function nextHistoryMode(now = Date.now()): 'push' | 'replace' {
  const mode = historyMode(lastChange, now);
  lastChange = now;
  return mode;
}
