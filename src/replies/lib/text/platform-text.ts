/**
 * Turns model output into text a social platform shows exactly as written.
 *
 * LinkedIn, Threads and X do not render markdown. A model told to write "plain
 * text ready to post" still reaches for **bold** and "* " bullets often enough to
 * matter, and before this nothing caught it: the asterisks went into the editor,
 * onto the clipboard and into a live post.
 *
 * Scope is deliberate. This runs on what a model wrote, before the owner sees it,
 * and never on anything the owner typed, which is saved byte for byte (SAVE-01).
 * Owner text with a trailing space or a literal asterisk stays exactly as typed.
 *
 * What survives is the formatting every platform actually shows: line breaks,
 * blank lines between paragraphs, bullet and numbered lists, emoji. Link targets
 * are dropped and their text kept, because a URL in a reply is the application's
 * job (C06), and a markdown link is just a URL the model tried to smuggle past it.
 *
 * Every rule is anchored so ordinary text is left alone: arithmetic ("5 * 3"), a
 * lone footnote asterisk, snake_case names and @handles all pass through
 * unchanged. The function is idempotent, so cleaning twice changes nothing.
 */
export function toPlatformText(input: string): string {
  let text = input.replace(/\r\n?/g, '\n');

  // Whole-line markup first, so a bullet's "* " is never read as emphasis.
  text = text
    .split('\n')
    .filter((line) => !/^\s*(```|~~~)/.test(line)) // code fences
    .map((line) =>
      // A horizontal rule was a section break, so it becomes a blank line rather
      // than vanishing and running two sections together.
      /^\s*([-*_])\s*(\1\s*){2,}$/.test(line)
        ? ''
        : line
        .replace(/^(\s*)#{1,6}\s+/, '$1') // headings
        .replace(/^(\s*)>\s?/, '$1') // block quotes
        // Every markdown bullet becomes a real bullet character, matching what
        // the formatting toolbar inserts, so one reply never mixes the two.
        .replace(/^(\s*)[-*+]\s+/, '$1• '),
    )
    .join('\n');

  // Images disappear entirely; links keep their text and lose the address.
  text = text.replace(/!\[[^\]\n]*\]\([^)\n]*\)/g, '');
  text = text.replace(/\[([^\]\n]+)\]\([^)\s]+\)/g, '$1');

  // Emphasis, strongest first so ***x*** is not half-consumed by the single form.
  text = text
    .replace(/\*\*\*(?=\S)([^*\n]+?)(?<=\S)\*\*\*/g, '$1')
    .replace(/\*\*(?=\S)([^\n]+?)(?<=\S)\*\*/g, '$1')
    .replace(/__(?=\S)([^\n]+?)(?<=\S)__/g, '$1')
    // A single asterisk only when it opens after a non-word and closes before one,
    // so "5 * 3" and a lone "*Terms apply" are untouched, and an escaped "\*" is
    // never taken as an opener or a closer.
    .replace(/(^|[^\w*\\])\*(?=\S)([^*\n]+?)(?<=[^\s\\])\*(?![\w*])/g, '$1$2')
    .replace(/~~(?=\S)([^~\n]+?)(?<=\S)~~/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1');

  // Escapes last, so an escaped asterisk is never mistaken for markup above.
  text = text.replace(/\\([*_#>`~[\]\\-])/g, '$1');

  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

