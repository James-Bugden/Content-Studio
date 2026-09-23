/**
 * Post text formatting (UX redesign).
 *
 * X, LinkedIn and Threads do not render Markdown: `**bold**` or `# Heading`
 * appears on the platform as literal symbols. Post copy is therefore kept as
 * plain text, and "formatting" means what the platforms actually display:
 * line breaks, bullet characters, and Unicode bold/italic letters.
 *
 * All functions are pure and isomorphic. Unicode styling applies to Latin
 * letters and digits only; Chinese and other scripts pass through unchanged.
 */

const BOLD = { upper: 0x1d5d4, lower: 0x1d5ee, digit: 0x1d7ec } as const; // Mathematical sans-serif bold
const ITALIC = { upper: 0x1d608, lower: 0x1d622 } as const; // Mathematical sans-serif italic (no digits)

function mapChar(ch: string, table: { upper: number; lower: number; digit?: number }): string {
  const c = ch.codePointAt(0)!;
  if (c >= 65 && c <= 90) return String.fromCodePoint(table.upper + (c - 65));
  if (c >= 97 && c <= 122) return String.fromCodePoint(table.lower + (c - 97));
  if (table.digit !== undefined && c >= 48 && c <= 57) return String.fromCodePoint(table.digit + (c - 48));
  return ch;
}

/** Map styled letters back to plain ASCII; everything else unchanged. */
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
  const letters = [...text].filter((ch) => /\S/.test(ch));
  return letters.length > 0 && toBold(text) === text && toPlain(text) !== text;
}

export function isItalic(text: string): boolean {
  return toItalic(text) === text && toPlain(text) !== text;
}

/** Toggle bold on a selection: bold becomes plain, anything else becomes bold. */
export function toggleBold(text: string): string {
  return isBold(text) ? toPlain(text) : toBold(text);
}

export function toggleItalic(text: string): string {
  return isItalic(text) ? toPlain(text) : toItalic(text);
}

const BULLET = /^(\s*)(?:•|[-*+])\s+/;
const NUMBERED = /^(\s*)\d{1,3}[.)]\s+/;

/** Toggle "• " bullets on every non-empty line of a block. */
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

/** Toggle "1. 2. 3." numbering on every non-empty line of a block. */
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

export type MarkdownFinding = { kind: 'bold' | 'italic' | 'heading' | 'list' | 'link' | 'code'; example: string };

const PATTERNS: { kind: MarkdownFinding['kind']; re: RegExp }[] = [
  { kind: 'bold', re: /\*\*[^*\n]+\*\*|__[^_\n]+__/ },
  { kind: 'heading', re: /^#{1,6}\s+\S.*$/m },
  { kind: 'list', re: /^\s*[-*+]\s+\S/m },
  { kind: 'link', re: /\[[^\]\n]+\]\([^)\s]+\)/ },
  { kind: 'code', re: /`[^`\n]+`/ },
  { kind: 'italic', re: /(^|[\s(])\*[^*\s][^*\n]*\*(?=[\s).,!?]|$)|(^|[\s(])_[^_\s][^_\n]*_(?=[\s).,!?]|$)/m },
];

/** Markdown syntax that X, LinkedIn and Threads would show as literal symbols. */
export function findMarkdown(text: string): MarkdownFinding[] {
  const out: MarkdownFinding[] = [];
  for (const p of PATTERNS) {
    const m = p.re.exec(text);
    if (m) out.push({ kind: p.kind, example: m[0].trim().slice(0, 40) });
  }
  return out;
}

/** Convert Markdown into platform-ready plain text. Never touches Chinese text. */
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

/**
 * Length as the platforms count it (code points, so emoji and styled letters
 * count once). X Premium allows long posts; LinkedIn allows 3,000 characters.
 */
export function platformLength(text: string): number {
  return [...text].length;
}

export const PLATFORM_LIMIT: Record<string, number> = { X: 25_000, LinkedIn: 3_000, Threads: 500 };
