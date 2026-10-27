/**
 * In-editor undo/redo for the post text (#242).
 *
 * The textarea is controlled, so the browser's own undo stack is lost whenever a
 * toolbar, hook, check or other programmatic edit replaces the value. This pure
 * reducer keeps the history instead. Typing bursts coalesce into one step;
 * every programmatic edit pushes the text it replaced first.
 */
export type Snapshot = {
  text: string;
  start: number;
  end: number;
  /** Hook chosen but not saved yet, so undo can take it back together with the text. */
  hook?: string | null;
};

export type History = { past: Snapshot[]; future: Snapshot[]; lastTypedAt: number | null };

export const HISTORY_CAP = 100;
export const COALESCE_MS = 500;

export const emptyHistory: History = { past: [], future: [], lastTypedAt: null };

const cap = (list: Snapshot[]) => (list.length > HISTORY_CAP ? list.slice(list.length - HISTORY_CAP) : list);

/** Record the state a change is about to replace. `type` bursts within COALESCE_MS share one step. */
export function pushHistory(history: History, before: Snapshot, kind: 'type' | 'edit', now: number): History {
  if (kind === 'type' && history.lastTypedAt !== null && now - history.lastTypedAt < COALESCE_MS && history.past.length > 0) {
    return { past: history.past, future: [], lastTypedAt: now };
  }
  return { past: cap([...history.past, before]), future: [], lastTypedAt: kind === 'type' ? now : null };
}

export function undoHistory(history: History, current: Snapshot): { history: History; snapshot: Snapshot } | null {
  const snapshot = history.past[history.past.length - 1];
  if (!snapshot) return null;
  return { snapshot, history: { past: history.past.slice(0, -1), future: cap([...history.future, current]), lastTypedAt: null } };
}

export function redoHistory(history: History, current: Snapshot): { history: History; snapshot: Snapshot } | null {
  const snapshot = history.future[history.future.length - 1];
  if (!snapshot) return null;
  return { snapshot, history: { past: cap([...history.past, current]), future: history.future.slice(0, -1), lastTypedAt: null } };
}

const isSpace = (ch: string | undefined) => ch === undefined || /\s/.test(ch);

/**
 * Where an old caret position lands after the text changed, so the caret stays on
 * the same words. When only whitespace changed (Fewer line breaks) it counts
 * visible characters; otherwise it keeps the common start and end of both texts.
 */
export function mapOffset(before: string, after: string, position: number): number {
  const pos = Math.max(0, Math.min(position, before.length));
  if (before === after) return pos;
  if (before.replace(/\s/g, '') === after.replace(/\s/g, '')) {
    let visible = 0;
    for (let i = 0; i < pos; i += 1) if (!isSpace(before[i])) visible += 1;
    if (visible === 0) return 0;
    let seen = 0;
    for (let i = 0; i < after.length; i += 1) {
      if (!isSpace(after[i])) seen += 1;
      if (seen === visible) return i + 1;
    }
    return after.length;
  }
  let prefix = 0;
  const max = Math.min(before.length, after.length);
  while (prefix < max && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < max - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1;
  if (pos <= prefix) return pos;
  if (pos >= before.length - suffix) return after.length - (before.length - pos);
  return after.length - suffix;
}
