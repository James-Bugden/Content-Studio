import { isTypingTarget } from '../keyboard';

/**
 * Keyboard shortcuts of the post panel (#247). Classification is pure so the gating
 * is testable; the panel decides whether the matching action is allowed and
 * enabled. Nothing here ever bypasses a button's own disabled state.
 */
export type ShortcutAction = 'approve-and-queue' | 'save-and-next' | 'previous' | 'next' | 'save-draft';

type KeyLike = { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean };

export function classifyShortcut(event: KeyLike, typing: boolean): ShortcutAction | null {
  const mod = event.metaKey || event.ctrlKey;
  if (mod && !event.altKey && event.key === 'Enter') return event.shiftKey ? 'approve-and-queue' : 'save-and-next';
  if (event.altKey && !mod && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) return event.key === 'ArrowDown' ? 'next' : 'previous';
  if (mod && !event.altKey && event.key.toLowerCase() === 's') return 'save-draft';
  if (mod || event.altKey || typing) return null;
  if (event.key === 'j' || event.key === 'J' || event.key === 'ArrowDown') return 'next';
  if (event.key === 'k' || event.key === 'K' || event.key === 'ArrowUp') return 'previous';
  return null;
}

/** The single-key movement (J/K/arrows) as opposed to a modified chord. */
export const isPlainMove = (event: KeyLike) => !(event.metaKey || event.ctrlKey || event.altKey);

/** The button a shortcut would press, only when it exists and is enabled (same gates as a click). */
export function enabledButton(root: ParentNode | null, selector: string): HTMLButtonElement | null {
  const button = root?.querySelector<HTMLButtonElement>(selector) ?? null;
  return button && !button.disabled && button.getAttribute('aria-disabled') !== 'true' ? button : null;
}

/** Post ids in page order from the list's panel links, for J/K on Next up and Review. */
export function listPostIds(root: ParentNode = document): string[] {
  const ids: string[] = [];
  for (const a of root.querySelectorAll<HTMLAnchorElement>('main a[aria-haspopup="dialog"][href*="post="]')) {
    const id = new URL(a.href, 'http://x').searchParams.get('post');
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export function neighbour(ids: readonly string[], current: string, direction: -1 | 1): string | null {
  const index = ids.indexOf(current);
  return index < 0 ? null : ids[index + direction] ?? null;
}

export { isTypingTarget };

export const SHORTCUT_HELP: { group: string; items: { keys: string; what: string }[] }[] = [
  { group: 'Post panel', items: [
    { keys: 'Ctrl/Cmd + S', what: 'Save draft' },
    { keys: 'Ctrl/Cmd + Enter', what: 'Save and open the next post' },
    { keys: 'Ctrl/Cmd + Shift + Enter', what: 'Approve and queue (when allowed)' },
    { keys: 'Alt + Up / Down', what: 'Previous / next post, even while typing' },
    { keys: 'K / J or Up / Down', what: 'Previous / next post (not while typing)' },
    { keys: 'Esc', what: 'Close the panel' },
  ] },
  { group: 'Lists', items: [
    { keys: '/', what: 'Search the Backlog' },
    { keys: '?', what: 'Show these shortcuts' },
  ] },
];
