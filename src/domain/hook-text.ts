/**
 * Put a chosen hook at the top of the post text (#242).
 *
 * - The hook already opens the text: nothing changes.
 * - The opening line or paragraph is the previous hook: it is replaced.
 * - No hook was saved and the post has more than one paragraph: the first
 *   paragraph is replaced (choosing is the confirmation).
 * - Otherwise the hook becomes a new first paragraph.
 * Everything after the replaced opening is kept byte for byte, including CRLF.
 */
export type HookPlacement = { text: string; mode: 'unchanged' | 'replaced' | 'prepended' };

const normal = (value: string) => value.replace(/\s+/g, ' ').trim();

export function placeHookInText(text: string, hook: string, previousHook: string): HookPlacement {
  const chosen = hook.trim();
  if (chosen === '') return { text, mode: 'unchanged' };
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lead = text.length - text.trimStart().length;
  const body = text.slice(lead);
  if (body === '') return { text: chosen, mode: 'prepended' };

  const lineEnd = body.search(/\r?\n/);
  const firstLine = lineEnd === -1 ? body : body.slice(0, lineEnd);
  const gap = /\r?\n[ \t]*\r?\n/.exec(body);
  const paragraphEnd = gap ? gap.index : body.length;
  const paragraph = body.slice(0, paragraphEnd);

  if (normal(firstLine) === normal(chosen) || normal(paragraph) === normal(chosen)) return { text, mode: 'unchanged' };

  const previous = normal(previousHook);
  let replaceEnd = -1;
  if (previous !== '') {
    if (normal(firstLine) === previous) replaceEnd = firstLine.length;
    else if (normal(paragraph) === previous) replaceEnd = paragraphEnd;
  } else if (gap) {
    replaceEnd = paragraphEnd;
  }
  if (replaceEnd >= 0) return { text: text.slice(0, lead) + chosen + body.slice(replaceEnd), mode: 'replaced' };
  return { text: chosen + eol + eol + text, mode: 'prepended' };
}
