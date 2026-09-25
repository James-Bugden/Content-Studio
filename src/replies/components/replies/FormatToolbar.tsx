'use client';

import type { RefObject } from 'react';
import { Meta } from './primitives';
import { FORMAT } from '@/replies/lib/workspace/copy';
import { PLATFORM_LABELS, type Platform } from '@/replies/lib/contracts/vocabulary';
import {
  cleanMarkdown,
  findMarkdown,
  platformLength,
  REPLY_LIMIT,
  toggleBold,
  toggleBullets,
  toggleItalic,
  toggleNumbers,
  toPlain,
} from '@/replies/lib/text/format';

/**
 * Formatting the platforms actually display, ported from Content Studio.
 *
 * It never inserts markdown: bold and italic use Unicode letters, lists use real
 * bullet and number characters, and "Clean up markdown" converts markdown the
 * owner pasted in. Every change goes through the editor's ordinary `onChange`,
 * exactly as a keystroke would, so version checks, translation staleness and
 * tab-local recovery all still apply. Nothing here runs unless a button is
 * pressed; typed text is never rewritten behind the owner's back (SAVE-01).
 */

function lineRange(text: string, start: number, end: number): [number, number] {
  const s = text.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
  const nl = text.indexOf('\n', end > start ? end - 1 : end);
  return [start === end && start > 0 && text[start - 1] === '\n' ? start : s, nl === -1 ? text.length : nl];
}

export interface FormatToolbarProps {
  textarea: RefObject<HTMLTextAreaElement | null>;
  text: string;
  platform: Platform;
  onChange(next: string): void;
}

export function FormatToolbar({ textarea, text, platform, onChange }: FormatToolbarProps) {
  const markdown = findMarkdown(text);
  const length = platformLength(text);
  const limit = REPLY_LIMIT[platform];
  const platformName = PLATFORM_LABELS[platform];
  const hasStyledLetters = toPlain(text) !== text;

  function apply(scope: 'selection' | 'lines', fn: (s: string) => string) {
    const el = textarea.current;
    if (!el) return;
    let start = el.selectionStart;
    let end = el.selectionEnd;
    if (scope === 'lines') [start, end] = lineRange(text, start, end);
    else if (start === end) {
      // No selection: act on the word under the cursor, as Content Studio does.
      const left = text.slice(0, start).search(/\S+$/);
      const right = text.slice(end).search(/\s|$/);
      start = left === -1 ? start : left;
      end = end + (right === -1 ? 0 : right);
    }
    const middle = fn(text.slice(start, end));
    onChange(text.slice(0, start) + middle + text.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start, start + middle.length);
    });
  }

  const button =
    'inline-flex min-h-9 min-w-9 items-center justify-center rounded-md border border-border-input bg-card px-2 text-meta hover:border-ink';

  return (
    <div className="mb-2 flex flex-col gap-2">
      <div role="toolbar" aria-label={FORMAT.toolbar} className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          className={`${button} font-bold`}
          aria-label={FORMAT.boldLabel}
          onClick={() => apply('selection', toggleBold)}
        >
          {FORMAT.bold}
        </button>
        <button
          type="button"
          className={`${button} italic`}
          aria-label={FORMAT.italicLabel}
          onClick={() => apply('selection', toggleItalic)}
        >
          {FORMAT.italic}
        </button>
        <button type="button" className={button} aria-label={FORMAT.bulletsLabel} onClick={() => apply('lines', toggleBullets)}>
          {FORMAT.bullets}
        </button>
        <button type="button" className={button} aria-label={FORMAT.numbersLabel} onClick={() => apply('lines', toggleNumbers)}>
          {FORMAT.numbers}
        </button>
        <button type="button" className={button} aria-label={FORMAT.clearLabel} onClick={() => apply('selection', toPlain)}>
          {FORMAT.clear}
        </button>
        <span
          className={`ml-auto text-meta sr-tnum ${length > limit ? 'font-medium text-danger' : 'text-ink-soft'}`}
        >
          {FORMAT.count(length, limit)}
          {length > limit ? ` · ${FORMAT.over(platformName)}` : ''}
        </span>
      </div>

      {markdown.length > 0 ? (
        <div
          role="status"
          className="flex flex-wrap items-center gap-2 rounded-md border border-border-input bg-paper-alt px-3 py-2 text-meta"
        >
          <span>{FORMAT.markdownFound(markdown.join(', '), platformName)}</span>
          <button type="button" className="underline underline-offset-2" onClick={() => onChange(cleanMarkdown(text))}>
            {FORMAT.cleanUp}
          </button>
        </div>
      ) : null}

      {/* Only once styled letters are actually present. Shown all the time it
          took two lines above the editor on a phone, warning about something
          the owner had not done. */}
      {hasStyledLetters ? <Meta>{FORMAT.note}</Meta> : null}
    </div>
  );
}

