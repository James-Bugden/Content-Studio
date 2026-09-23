import { fingerprint } from './hash';

/**
 * Library-ID sections inside a master Markdown file (CS-004, DRV-01).
 *
 * A section starts at an ATX heading line whose text contains the Library ID as a
 * whole token (for example `## LIB-0042 · Negotiation myths`) and runs until the
 * next heading of the same or a higher level. The body is everything between the
 * heading line and the next heading, minus one separating blank line on each side,
 * which is kept as frame. Every byte outside the body is preserved exactly.
 *
 * Markdown is untrusted data: nothing here renders HTML, follows links or reads
 * instructions from the text.
 */
export type MarkdownSection = {
  libraryId: string;
  headingLine: string;
  level: number;
  /** Exact body text, including internal blank lines. */
  body: string;
  bodyHash: string;
  /** Byte-ish offsets into the original string (UTF-16 code units). */
  bodyStart: number;
  bodyEnd: number;
};

export type SectionLookup =
  | { ok: true; section: MarkdownSection }
  | { ok: false; reason: 'missing' | 'duplicate'; count: number };

const HEADING = /^(#{1,6})[ \t]+(.*)$/;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

type Line = { text: string; start: number; end: number; newline: string };

function splitLines(source: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  const re = /\r\n|\n|\r/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    lines.push({ text: source.slice(start, match.index), start, end: match.index, newline: match[0] });
    start = match.index + match[0].length;
  }
  lines.push({ text: source.slice(start), start, end: source.length, newline: '' });
  return lines;
}

export function findSection(source: string, libraryId: string): SectionLookup {
  const token = new RegExp(`(^|[^A-Za-z0-9_-])${escapeRegExp(libraryId)}([^A-Za-z0-9_-]|$)`);
  const lines = splitLines(source);
  let inFence = false;
  const headings: { index: number; level: number }[] = [];
  lines.forEach((line, index) => {
    if (/^\s{0,3}(```|~~~)/.test(line.text)) inFence = !inFence;
    if (inFence) return;
    const m = HEADING.exec(line.text);
    if (m) headings.push({ index, level: m[1]!.length });
  });

  const matches = headings.filter((h) => token.test(HEADING.exec(lines[h.index]!.text)![2]!));
  if (matches.length === 0) return { ok: false, reason: 'missing', count: 0 };
  if (matches.length > 1) return { ok: false, reason: 'duplicate', count: matches.length };

  const head = matches[0]!;
  const next = headings.find((h) => h.index > head.index && h.level <= head.level);
  const headLine = lines[head.index]!;
  let first = head.index + 1;
  let last = (next ? next.index : lines.length) - 1;
  // One separating blank line after the heading and before the next heading is frame.
  if (first <= last && lines[first]!.text.trim() === '') first += 1;
  if (next && last >= first && lines[last]!.text.trim() === '') last -= 1;

  let bodyStart: number;
  let bodyEnd: number;
  if (first > last) {
    bodyStart = first < lines.length ? lines[first]!.start : source.length;
    bodyEnd = bodyStart;
  } else {
    bodyStart = lines[first]!.start;
    bodyEnd = lines[last]!.end;
  }
  const body = source.slice(bodyStart, bodyEnd);
  return {
    ok: true,
    section: { libraryId, headingLine: headLine.text, level: head.level, body, bodyHash: fingerprint(body), bodyStart, bodyEnd },
  };
}

/** Replace only the body of a section. Every other byte is returned unchanged. */
export function replaceSectionBody(source: string, section: MarkdownSection, newBody: string): string {
  const before = source.slice(0, section.bodyStart);
  const after = source.slice(section.bodyEnd);
  if (section.body === '' && newBody !== '') {
    // An empty section has no frame yet: give the new body its own lines.
    const lead = before.endsWith('\n') ? '' : '\n\n';
    const trail = after === '' || after.startsWith('\n') ? '' : '\n\n';
    return before + lead + newBody + trail + after;
  }
  return before + newBody + after;
}
