import { describe, it, expect } from 'vitest';
import { parseProviderOutput } from '@/replies/lib/ai/guards';
import { parseRewriteOutput, parseTranslationOutput } from '@/replies/lib/ai/tasks';

/**
 * Every model answer is cleaned into platform text at the point it is parsed.
 *
 * Parsing is the one place all model output passes through before the guards, the
 * API and the screen see it. Cleaning there means the grounding checks judge the
 * text the owner will actually post, and no later caller can forget to do it.
 */

const idea = (position: number, overrides: Record<string, unknown> = {}) => ({
  position,
  angle_label: `Angle ${position}`,
  reply_text: `Plain reply ${position}.`,
  english_meaning: null,
  resource_id: null,
  cta_text: null,
  uses_fact_ids: [],
  based_on_reply_ids: [],
  ...overrides,
});

const ideasPayload = (first: Record<string, unknown>) =>
  JSON.stringify({ ideas: [idea(0, first), idea(1), idea(2)] });

describe('generated ideas', () => {
  it('arrive without markdown, keeping their paragraph breaks', () => {
    const parsed = parseProviderOutput(
      ideasPayload({
        angle_label: '**Shorter**',
        reply_text: '**Short answer:** yes.\n\n* ask for the range\n* then anchor',
        english_meaning: '*Short* answer',
        cta_text: 'See [the guide](https://example.com/guide)',
      }),
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const first = parsed.value.ideas.find((i) => i.position === 0)!;
    expect(first.angle_label).toBe('Shorter');
    expect(first.reply_text).toBe('Short answer: yes.\n\n• ask for the range\n• then anchor');
    expect(first.english_meaning).toBe('Short answer');
    expect(first.cta_text).toBe('See the guide');
  });

  it('refuses an idea that was nothing but formatting', () => {
    // Otherwise an image-only answer would reach the owner as an empty card.
    const parsed = parseProviderOutput(ideasPayload({ reply_text: '![chart](https://example.com/c.png)' }));

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.detail).toContain('reply_text');
  });
});

describe('rewrites and translations', () => {
  it('clean a rewrite the same way', () => {
    const parsed = parseRewriteOutput(
      JSON.stringify({ revised_text: '## Tighter\n**Ask** for the range.', english_meaning: null, uses_fact_ids: [] }),
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.revised_text).toBe('Tighter\nAsk for the range.');
  });

  it('clean an English meaning the same way', () => {
    const parsed = parseTranslationOutput(JSON.stringify({ english_meaning: 'The point is **specifics**.' }));

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.english_meaning).toBe('The point is specifics.');
  });

  it('refuse a rewrite that was nothing but formatting', () => {
    const parsed = parseRewriteOutput(
      JSON.stringify({ revised_text: '---', english_meaning: null, uses_fact_ids: [] }),
    );
    expect(parsed.ok).toBe(false);
  });
});

