/**
 * Hook Alternatives cell, split for display (CS-054). The Sheet holds a numbered
 * list written by the hook review, e.g.
 *
 *   1) 8/10 | Opinion #65, The problem with [thing] (adapted): Working hard on…
 *   2) 8.5/10 | Trending #3, Reddit screenshots: Two comments here tell you…
 *
 * Shown raw it is one long run of text that makes every row tall. This splits it
 * into score, template and hook so the table can show each alternative as a
 * compact line. Anything that does not match the pattern is kept whole as the
 * hook, so no text is ever dropped.
 */
export type HookAlternative = { score: string | null; template: string | null; hook: string };

const ITEM_START = /^\s*\d{1,2}[).]\s+/m;
const SCORE = /^(\d{1,2}(?:\.\d)?\s*\/\s*10)\s*\|\s*/;
/** A template label ends at the first colon, if that colon comes early enough to be a label. */
const TEMPLATE_MAX = 140;

export function parseHookAlternatives(raw: string): HookAlternative[] {
  const text = raw.replace(/\r\n?/g, '\n').trim();
  if (!text) return [];
  const parts = ITEM_START.test(text) ? text.split(/^\s*\d{1,2}[).]\s+/m).map((p) => p.trim()).filter(Boolean) : [text];
  return parts.map((part) => {
    let rest = part.replace(/\s*\n\s*/g, ' ');
    let score: string | null = null;
    const s = SCORE.exec(rest);
    if (s) {
      score = s[1]!.replace(/\s+/g, '');
      rest = rest.slice(s[0].length);
    }
    let template: string | null = null;
    const colon = rest.indexOf(': ');
    if (score && colon > 0 && colon <= TEMPLATE_MAX) {
      template = rest.slice(0, colon).trim();
      rest = rest.slice(colon + 2);
    }
    return { score, template, hook: rest.trim() };
  });
}
