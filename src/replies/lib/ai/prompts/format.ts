/**
 * How a reply may be formatted, said once for every task that writes one.
 *
 * "Plain text ready to post" was the whole instruction, and models read it as
 * permission to keep using **bold** and "* " bullets. LinkedIn, Threads and X
 * render none of it, so it reached the owner's post as literal asterisks.
 *
 * This asks for what the platforms do show. `toPlatformText` still cleans every
 * answer afterwards, because an instruction is a request and not a guarantee;
 * asking properly just means fewer answers need cleaning.
 */
export const PLATFORM_FORMAT_RULES = [
  'The text is posted exactly as written on a platform that does not render markdown.',
  'So: no asterisks or underscores for emphasis, no # headings, no [text](link) links,',
  'no code formatting and no horizontal rules. Separate paragraphs with a blank line.',
  'For a list, put each item on its own line starting with "• ".',
].join('\n');

