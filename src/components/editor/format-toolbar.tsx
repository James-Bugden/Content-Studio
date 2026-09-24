'use client';

import { cleanMarkdown, findMarkdown, platformLength, PLATFORM_LIMIT, toggleBold, toggleBullets, toggleItalic, toggleNumbers, toPlain } from '@/domain/format';

/**
 * Formatting that the platforms actually display (UX redesign). X, LinkedIn and
 * Threads show Markdown as literal symbols, so this toolbar never inserts
 * Markdown: bold and italic use Unicode letters, lists use real bullet and
 * number characters, and "Clean up Markdown" converts pasted Markdown. Every
 * change goes through the normal text state, so undo, recovery and the explicit
 * save still apply.
 */
type Props = {
  textarea: React.RefObject<HTMLTextAreaElement | null>;
  text: string;
  platform: string;
  disabled?: boolean;
  onChange: (next: string) => void;
};

function lineRange(text: string, start: number, end: number): [number, number] {
  const s = text.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
  const nl = text.indexOf('\n', end > start ? end - 1 : end);
  return [start === end && start > 0 && text[start - 1] === '\n' ? start : s, nl === -1 ? text.length : nl];
}

export function FormatToolbar({ textarea, text, platform, disabled, onChange }: Props) {
  const markdown = findMarkdown(text);
  const length = platformLength(text);
  const limit = PLATFORM_LIMIT[platform];

  function apply(scope: 'selection' | 'lines', fn: (s: string) => string) {
    const el = textarea.current;
    if (!el || disabled) return;
    let start = el.selectionStart;
    let end = el.selectionEnd;
    if (scope === 'lines') [start, end] = lineRange(text, start, end);
    else if (start === end) {
      // No selection: apply to the word under the cursor.
      const left = text.slice(0, start).search(/\S+$/);
      const right = text.slice(end).search(/\s|$/);
      start = left === -1 ? start : left;
      end = end + (right === -1 ? 0 : right);
    }
    const middle = fn(text.slice(start, end));
    const next = text.slice(0, start) + middle + text.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start, start + middle.length);
    });
  }

  const btn =
    'inline-flex min-h-9 min-w-9 items-center justify-center rounded-md border border-line bg-card px-2 text-sm hover:border-ink disabled:opacity-50';
  return (
    <div className="flex flex-col gap-2">
      <div role="toolbar" aria-label="Formatting" className="flex flex-wrap items-center gap-1.5">
        <button type="button" className={`${btn} font-bold`} disabled={disabled} onClick={() => apply('selection', toggleBold)} aria-label="Bold (Unicode letters)" title="Bold: uses Unicode letters that X, LinkedIn and Threads display">
          B
        </button>
        <button type="button" className={`${btn} italic`} disabled={disabled} onClick={() => apply('selection', toggleItalic)} aria-label="Italic (Unicode letters)" title="Italic: uses Unicode letters">
          I
        </button>
        <button type="button" className={btn} disabled={disabled} onClick={() => apply('lines', toggleBullets)} aria-label="Bulleted list">
          • List
        </button>
        <button type="button" className={btn} disabled={disabled} onClick={() => apply('lines', toggleNumbers)} aria-label="Numbered list">
          1. List
        </button>
        <button type="button" className={btn} disabled={disabled} onClick={() => apply('selection', toPlain)} aria-label="Remove bold and italic from the selection">
          Clear style
        </button>
        <span className="ml-auto text-xs tabular-nums text-ink-soft">
          {length.toLocaleString('en-GB')}
          {limit ? ` / ${limit.toLocaleString('en-GB')}` : ''} characters
          {limit && length > limit ? <strong className="ml-1 text-block">Over the {platform} limit</strong> : null}
        </span>
      </div>
      {markdown.length > 0 ? (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-paper px-3 py-2 text-sm">
          <span>
            This text contains Markdown ({markdown.map((m) => m.kind).join(', ')}). {platform || 'The platform'} will show those symbols as typed.
          </span>
          <button type="button" className="underline" disabled={disabled} onClick={() => onChange(cleanMarkdown(text))}>
            Clean up Markdown
          </button>
        </div>
      ) : null}
      <p className="text-xs text-ink-soft">Bold and italic use special letters. Screen readers may spell them out, so keep them to a few words.</p>
    </div>
  );
}
