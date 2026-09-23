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

const FENCE = /^\s{0,3}(```|~~~)/;

/**
 * Structural safety for a section body (adversarial review finding 1). A body
 * must not open a new section at or above its own level and must not leave a
 * code fence open, otherwise saving it would swallow or hide the sections after
 * it in the shared master file.
 */
export function sectionBodyProblems(body: string, level: number): ('heading' | 'fence')[] {
  const problems = new Set<'heading' | 'fence'>();
  let inFence = false;
  for (const line of body.split(/\r\n|\n|\r/)) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = HEADING.exec(line);
    if (m && m[1]!.length <= level) problems.add('heading');
  }
  if (inFence) problems.add('fence');
  return [...problems];
}

/** Heading lines outside code fences, in order. */
export function headingOutline(source: string): string[] {
  const out: string[] = [];
  let inFence = false;
  for (const line of source.split(/\r\n|\n|\r/)) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence && HEADING.test(line)) out.push(line);
  }
  return out;
}

/**
 * Replace a section body only if the result keeps every other heading exactly
 * and the section still resolves to the new body. Returns null when unsafe.
 */
export function safeReplaceSectionBody(source: string, section: MarkdownSection, newBody: string): string | null {
  if (sectionBodyProblems(newBody, section.level).length > 0) return null;
  const next = replaceSectionBody(source, section, newBody);
  const found = findSection(next, section.libraryId);
  if (!found.ok || found.section.body !== newBody) return null;
  const before = headingOutline(source);
  const bodyHeadings = headingOutline(section.body);
  const newBodyHeadings = headingOutline(newBody);
  const expected = [...before];
  // Our own body's sub-headings may change; every other heading must survive in order.
  const strip = (list: string[], remove: string[]) => {
    const copy = [...list];
    for (const h of remove) {
      const i = copy.indexOf(h);
      if (i >= 0) copy.splice(i, 1);
    }
    return copy;
  };
  const after = strip(headingOutline(next), newBodyHeadings);
  return JSON.stringify(after) === JSON.stringify(strip(expected, bodyHeadings)) ? next : null;
}
