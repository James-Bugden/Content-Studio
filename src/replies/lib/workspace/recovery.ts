'use client';

import type { Platform, TargetKind } from '@/replies/lib/contracts/vocabulary';

/**
 * Tab-local draft recovery (C10, D14).
 *
 * The workspace is a client component, so opening Library or Resources unmounts
 * it and the reply being written goes with it. D14 requires navigation to
 * preserve the active session, and C10 names the mechanism: a short-lived,
 * tab-scoped fallback, which is what `sessionStorage` is.
 *
 * Three things this deliberately is not:
 *
 *   * it is not the source of truth. The versioned server draft is, and this only
 *     covers the gap between unmount and remount;
 *   * it is not encrypted, and nothing in the interface says it is. It holds the
 *     owner's own writing on the owner's own machine, in one tab, until that tab
 *     closes;
 *   * it never holds a token, a fact, a retrieved reply or an imported archive.
 *     Just the text in the box and enough context to put it back.
 *
 * It is cleared on Next reply and on sign-out. An earlier version of this comment
 * also claimed "an explicit discard", and there is no such control; sign-out did
 * not exist either until SEC-05 was checked rather than read. A comment that
 * asserts a security behaviour nothing implements answers the exact question a
 * reviewer came to ask, wrongly.
 */

const KEY = 'social-replies.draft.v1';

export interface RecoverableDraft {
  sessionId: string;
  platform: Platform;
  targetKind: TargetKind;
  sourceText: string;
  parentText: string;
  sourceUrl: string;
  draft: string;
  editorVersion: number;
  sourceVersion: number;
  contextVersion: number;
  savedAt: number;
}

/** Beyond this, the text is more likely to confuse than to help. */
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    // Private mode, blocked site data, or a preview frame. Recovery is a
    // convenience, so its absence must never break the page.
    return null;
  }
}

export function rememberDraft(draft: Omit<RecoverableDraft, 'savedAt'>): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(KEY, JSON.stringify({ ...draft, savedAt: Date.now() }));
  } catch {
    // Quota, or a browser that refuses. Losing the fallback is acceptable; the
    // server draft is the real one.
  }
}

export function recallDraft(): RecoverableDraft | null {
  const store = storage();
  if (!store) return null;

  let raw: string | null = null;
  try {
    raw = store.getItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as RecoverableDraft;
    if (typeof parsed?.sessionId !== 'string' || typeof parsed?.draft !== 'string') return null;
    if (Date.now() - (parsed.savedAt ?? 0) > MAX_AGE_MS) {
      forgetDraft();
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function forgetDraft(): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(KEY);
  } catch {
    // Nothing to do. The next read validates what it finds anyway.
  }
}

