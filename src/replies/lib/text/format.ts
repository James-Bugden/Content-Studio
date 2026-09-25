import type { Platform } from '@/replies/lib/contracts/vocabulary';

/**
 * Formatting the owner applies to their own reply.
 *
 * Ported from Content Studio (src/domain/format.ts) so both tools format the same
 * way. LinkedIn, Threads and X render no markdown, so "formatting" here means what
 * those platforms actually display: line breaks, real bullet and number
 * characters, and Unicode bold and italic letters.
 *
 * Two deliberate differences from how model output is handled
 * (`toPlatformText`):
 *
 *   * the owner's `**bold**` becomes real bold letters, because the owner chose
 *     the emphasis; a model's `**bold**` is stripped, because nobody asked for it;
 *   * the owner's `[text](url)` keeps its address as "text (url)", because the
 *     owner may link what they like; a model may not, links are the app's job.
 *
 * Nothing here runs unless the owner presses a button. Text they typed is never
 * rewritten behind their back (SAVE-01).
 *
 * Unicode styling covers Latin letters and digits only. Chinese and every other
 * script pass through unchanged, so Bold on a Chinese selection is a no-op rather
 * than a corruption.
 */

const BOLD = { upper: 0x1d5d4, lower: 0x1d5ee, digit: 0x1d7ec } as const; // mathematical sans-serif bold
const ITALIC = { upper: 0x1d608, lower: 0x1d622 } as const; // mathematical sans-serif italic, no digits

function mapChar(ch: string, table: { upper: number; lower: number; digit?: number }): string {
  const c = ch.codePointAt(0)!;
  if (c >= 65 && c <= 90) return String.fromCodePoint(table.upper + (c - 65));
  if (c >= 97 && c <= 122) return String.fromCodePoint(table.lower + (c - 97));
  if (table.digit !== undefined && c >= 48 && c <= 57) return String.fromCodePoint(table.digit + (c - 48));
  return ch;
}

/** Styled letters back to plain ASCII; everything else unchanged. */
export function toPlain(text: string): string {
  let out = '';
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c >= BOLD.upper && c < BOLD.upper + 26) out += String.fromCharCode(65 + c - BOLD.upper);
    else if (c >= BOLD.lower && c < BOLD.lower + 26) out += String.fromCharCode(97 + c - BOLD.lower);
    else if (c >= BOLD.digit && c < BOLD.digit + 10) out += String.fromCharCode(48 + c - BOLD.digit);
    else if (c >= ITALIC.upper && c < ITALIC.upper + 26) out += String.fromCharCode(65 + c - ITALIC.upper);
    else if (c >= ITALIC.lower && c < ITALIC.lower + 26) out += String.fromCharCode(97 + c - ITALIC.lower);
    else out += ch;
  }
  return out;
}

export function toBold(text: string): string {
  return [...toPlain(text)].map((ch) => mapChar(ch, BOLD)).join('');
}

export function toItalic(text: string): string {
  return [...toPlain(text)].map((ch) => mapChar(ch, ITALIC)).join('');
}

export function isBold(text: string): boolean {
  return toBold(text) === text && toPlain(text) !== text;
}

export function isItalic(text: string): boolean {
  return toItalic(text) === text && toPlain(text) !== text;
}

/** Bold becomes plain; anything else becomes bold. */
export function toggleBold(text: string): string {
  return isBold(text) ? toPlain(text) : toBold(text);
}

/** Italic becomes plain; anything else, bold included, becomes italic. */
export function toggleItalic(text: string): string {
  return isItalic(text) ? toPlain(text) : toItalic(text);
}

const BULLET = /^(\s*)(?:•|[-*+])\s+/;
const NUMBERED = /^(\s*)\d{1,3}[.)]\s+/;

/** "• " on every non-empty line of a block, or off again if they all have one. */
export function toggleBullets(block: string): string {
  const lines = block.split('\n');
  const content = lines.filter((l) => l.trim() !== '');
  const allBulleted = content.length > 0 && content.every((l) => /^\s*•\s/.test(l));
  return lines
    .map((l) => {
      if (l.trim() === '') return l;
      if (allBulleted) return l.replace(/^(\s*)•\s+/, '$1');
      return l.replace(BULLET, '$1').replace(NUMBERED, '$1').replace(/^(\s*)/, '$1• ');
    })
    .join('\n');
}

/** "1. 2. 3." on every non-empty line of a block, or off again. */
export function toggleNumbers(block: string): string {
  const lines = block.split('\n');
  const content = lines.filter((l) => l.trim() !== '');
  const allNumbered = content.length > 0 && content.every((l) => NUMBERED.test(l));
  let n = 0;
  return lines
    .map((l) => {
      if (l.trim() === '') return l;
      if (allNumbered) return l.replace(NUMBERED, '$1');
      n += 1;
      return l.replace(BULLET, '$1').replace(NUMBERED, '$1').replace(/^(\s*)/, `$1${n}. `);
    })
    .join('\n');
}

export type MarkdownKind = 'bold' | 'italic' | 'heading' | 'list' | 'link' | 'code';

const PATTERNS: { kind: MarkdownKind; re: RegExp }[] = [
  { kind: 'bold', re: /\*\*[^*\n]+\*\*|__[^_\n]+__/ },
  { kind: 'heading', re: /^#{1,6}\s+\S.*$/m },
  { kind: 'list', re: /^\s*[*+]\s+\S/m },
  { kind: 'link', re: /\[[^\]\n]+\]\([^)\s]+\)/ },
  { kind: 'code', re: /`[^`\n]+`/ },
  { kind: 'italic', re: /(^|[\s(])\*[^*\s][^*\n]*\*(?=[\s).,!?]|$)|(^|[\s(])_[^_\s][^_\n]*_(?=[\s).,!?]|$)/m },
];

/**
 * Markdown the platforms would show as literal symbols.
 *
 * A "- " list is not reported. It reads naturally as plain text on every
 * platform, and warning about it would nag the owner over nothing.
 */
export function findMarkdown(text: string): MarkdownKind[] {
  return PATTERNS.filter((p) => p.re.test(text)).map((p) => p.kind);
}

/** The owner's markdown, turned into what the platforms display. Chinese is untouched. */
export function cleanMarkdown(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      let l = line;
      const heading = /^(\s*)#{1,6}\s+(.*)$/.exec(l);
      if (heading) l = `${heading[1]}${toBold(heading[2]!)}`;
      l = l.replace(/^(\s*)[-*+]\s+(?=\S)/, '$1• ');
      return l;
    })
    .join('\n')
    .replace(/\*\*([^*\n]+)\*\*|__([^_\n]+)__/g, (_m, a: string | undefined, b: string | undefined) => toBold(a ?? b ?? ''))
    .replace(/(^|[\s(])\*([^*\s][^*\n]*)\*(?=[\s).,!?]|$)/gm, (_m, pre: string, inner: string) => `${pre}${toItalic(inner)}`)
    .replace(/(^|[\s(])_([^_\s][^_\n]*)_(?=[\s).,!?]|$)/gm, (_m, pre: string, inner: string) => `${pre}${toItalic(inner)}`)
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, '$1 ($2)')
    .replace(/`([^`\n]+)`/g, '$1');
}

/** Length as the platforms count it: code points, so emoji and styled letters count once. */
export function platformLength(text: string): number {
  return [...text].length;
}

/**
 * Reply limits, which are not post limits.
 *
 * Threads: 500 for posts and replies alike, with no paid tier that raises it.
 * LinkedIn: 1,250 for a comment. LinkedIn does not document this officially; it
 * is the consistently reported figure, and the composer stops typing at the cap.
 * X: 25,000 with Premium, matching Content Studio's assumption. Without Premium
 * the limit is 280, and this number would need to change.
 */
export const REPLY_LIMIT: Record<Platform, number> = { linkedin: 1_250, x: 25_000, threads: 500 };

