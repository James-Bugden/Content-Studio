import { providerOutputSchema, type ProviderOutput } from '../types';
import { toPlatformText } from '@/replies/lib/text/platform-text';

/**
 * Turning a provider's text into a validated structure (AI-01).
 *
 * Models wrap JSON in prose or in a fenced code block often enough that refusing to
 * look is a needless failure. Extraction is therefore tolerant about *where* the
 * JSON is and strict about what it contains: nothing downstream sees an unvalidated
 * object.
 */

export type ParseResult =
  | { ok: true; value: ProviderOutput }
  | { ok: false; reason: 'not_json' | 'wrong_shape'; detail: string };

/** Finds the outermost balanced JSON object, ignoring braces inside strings. */
export function extractJsonObject(text: string): string | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const haystack = fenced?.[1] ?? text;

  const start = haystack.indexOf('{');
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < haystack.length; i += 1) {
    const char = haystack[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return haystack.slice(start, i + 1);
    }
  }
  return null;
}

export function parseProviderOutput(rawText: string): ParseResult {
  const candidate = extractJsonObject(rawText);
  if (!candidate) {
    return { ok: false, reason: 'not_json', detail: 'No JSON object found in the response.' };
  }

  let value: unknown;
  try {
    value = JSON.parse(candidate);
  } catch {
    return { ok: false, reason: 'not_json', detail: 'The response was not parseable JSON.' };
  }

  const result = providerOutputSchema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    return {
      ok: false,
      reason: 'wrong_shape',
      // The path, never the value: the value is the owner's writing.
      detail: `${issue?.path.join('.') ?? 'ideas'}: ${issue?.message ?? 'did not match the schema'}`,
    };
  }

  // Cleaned here, at the one point every generated idea passes through, so the
  // guards judge the text the owner will actually post and no later caller can
  // forget. See toPlatformText for why model markdown never reaches a platform.
  const ideas = result.data.ideas.map((idea) => ({
    ...idea,
    angle_label: toPlatformText(idea.angle_label),
    reply_text: toPlatformText(idea.reply_text),
    english_meaning: idea.english_meaning === null ? null : toPlatformText(idea.english_meaning),
    cta_text: idea.cta_text === null ? null : toPlatformText(idea.cta_text),
  }));

  const emptied = ideas.find((i) => i.reply_text === '');
  if (emptied) {
    // An answer that was only an image or a rule would otherwise reach the owner
    // as an empty card.
    return {
      ok: false,
      reason: 'wrong_shape',
      detail: `ideas.${emptied.position}.reply_text: nothing was left once formatting was removed.`,
    };
  }

  const positions = ideas.map((i) => i.position).sort();
  if (positions.join(',') !== '0,1,2') {
    return { ok: false, reason: 'wrong_shape', detail: 'ideas must occupy positions 0, 1 and 2.' };
  }

  return { ok: true, value: { ...result.data, ideas } };
}

