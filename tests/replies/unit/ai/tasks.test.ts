import { describe, it, expect } from 'vitest';
import {
  assembleRewriteInstruction,
  assembleTranslationInstruction,
  checkRewrite,
  parseRewriteOutput,
  parseTranslationOutput,
} from '@/replies/lib/ai/tasks';
import { createFakeGenerator } from '@/replies/lib/ai/providers/fake';
import { runGuards } from '@/replies/lib/ai/guards';
import type { GenerationContext } from '@/replies/lib/ai/types';

/**
 * The single-answer tasks: a rewrite of the owner's draft, and the English meaning
 * of a Chinese one.
 *
 * Both reach the owner as something they act on. A rewrite is one click from the
 * editor and a meaning is what they check the Chinese against, so neither can be
 * whatever text happened to come back.
 */

function context(overrides: Partial<GenerationContext> = {}): GenerationContext {
  return {
    platform: 'linkedin',
    sourceText: 'Does anybody actually read cover letters anymore?',
    parentText: null,
    writing: [],
    facts: [],
    resources: [],
    recentReplies: [],
    seedReplyIds: [],
    ...overrides,
  };
}

const ACME_FACT = {
  id: '11111111-1111-4111-8111-111111111111',
  version: 1,
  text: 'helped with engineering hiring at Acme',
};

/** The exact proposal the refine path used to hand straight back to the editor. */
const OVERSTATED_REWRITE =
  'I led hiring for 200 engineers at Acme. See https://evil.example/thing for more.';

function abortableOptions(task: 'ideas' | 'rewrite' | 'translation') {
  return { signal: new AbortController().signal, maxOutputTokens: 1_000, task } as const;
}

describe('a refined proposal is held to the same checks as a generated idea', () => {
  it('rejects a rewrite that adds a link, a figure and an unsupported claim', () => {
    const report = checkRewrite(
      { revised_text: OVERSTATED_REWRITE, english_meaning: null, uses_fact_ids: [] },
      'shorter',
      context({ facts: [ACME_FACT] }),
      '',
    );

    const codes = report.hardFailures.map((failure) => failure.code);
    expect(codes).toContain('raw_url');
    expect(codes).toContain('unsupported_first_person');
    expect(codes).toContain('unsupported_number');
  });

  it('finds exactly what runGuards finds, rather than a second set of rules', () => {
    const shared = context({ facts: [ACME_FACT] });
    const direct = runGuards(
      [
        {
          position: 0,
          angle_label: 'shorter',
          reply_text: OVERSTATED_REWRITE,
          english_meaning: null,
          resource_id: null,
          cta_text: null,
          uses_fact_ids: [],
          based_on_reply_ids: [],
        },
      ],
      shared,
    );

    const viaRewrite = checkRewrite(
      { revised_text: OVERSTATED_REWRITE, english_meaning: null, uses_fact_ids: [] },
      'shorter',
      shared,
      '',
    );

    expect(viaRewrite.hardFailures).toEqual(direct.hardFailures);
  });

  it('catches an escalation from taking part in something to having run it', () => {
    const report = checkRewrite(
      {
        revised_text: 'I led engineering hiring at Acme, so this comes up a lot.',
        english_meaning: null,
        uses_fact_ids: [ACME_FACT.id],
      },
      'add_personal_example',
      context({ facts: [ACME_FACT] }),
      '',
    );

    expect(report.hardFailures.map((failure) => failure.code)).toContain('overstated_responsibility');
  });

  it('lets a grounded rewrite through', () => {
    const report = checkRewrite(
      {
        revised_text: 'Most of them are read once, quickly. Name the problem you solved in line one.',
        english_meaning: null,
        uses_fact_ids: [],
      },
      'shorter',
      context({ facts: [ACME_FACT] }),
      '',
    );

    expect(report.hardFailures).toEqual([]);
  });

  it('will not offer a Chinese rewrite with no English to check it against', () => {
    const report = checkRewrite(
      { revised_text: '履歷第一行就要說清楚你解決過什麼問題。', english_meaning: null, uses_fact_ids: [] },
      'shorter',
      context({ platform: 'threads' }),
      '',
    );

    expect(report.hardFailures.map((failure) => failure.code)).toContain('missing_english_meaning');
  });
});

describe('a task answer is validated against the shape that task asked for', () => {
  it('refuses the ideas payload as a rewrite', () => {
    const ideasPayload = JSON.stringify({
      ideas: [{ position: 0, angle_label: 'Direct answer', reply_text: 'Example reply.' }],
    });

    expect(parseRewriteOutput(ideasPayload).ok).toBe(false);
    expect(parseTranslationOutput(ideasPayload).ok).toBe(false);
  });

  it('refuses an empty revision and an empty meaning', () => {
    expect(parseRewriteOutput('{"revised_text":"   "}').ok).toBe(false);
    expect(parseTranslationOutput('{"english_meaning":"   "}').ok).toBe(false);
  });

  it('reads a well-formed answer, including one wrapped in a fenced block', () => {
    const parsed = parseRewriteOutput('```json\n{"revised_text":"Shorter version."}\n```');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.revised_text).toBe('Shorter version.');
      expect(parsed.value.english_meaning).toBeNull();
      expect(parsed.value.uses_fact_ids).toEqual([]);
    }
  });
});

describe('the fake provider answers the question it was asked', () => {
  it('returns a rewrite, not its ideas payload, for a rewrite request', async () => {
    const generator = createFakeGenerator();
    const instruction = assembleRewriteInstruction('shorter', [], { requireEnglishMeaning: false });

    const attempt = await generator.complete(instruction, 'My draft reply.', abortableOptions('rewrite'));

    expect(attempt.rawText).not.toContain('"ideas"');
    const parsed = parseRewriteOutput(attempt.rawText);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.revised_text).toMatch(/example/i);
    expect(checkRewrite(parsed.value, 'shorter', context(), '').hardFailures).toEqual([]);
  });

  it('returns Chinese with an English meaning when the platform reviews in English', async () => {
    const generator = createFakeGenerator();
    const instruction = assembleRewriteInstruction('warmer', [], { requireEnglishMeaning: true });

    const attempt = await generator.complete(instruction, '我的草稿。', abortableOptions('rewrite'));
    const parsed = parseRewriteOutput(attempt.rawText);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.revised_text).toMatch(/\p{Script=Han}/u);
    expect(parsed.value.english_meaning).toMatch(/example/i);
    expect(
      checkRewrite(parsed.value, 'warmer', context({ platform: 'threads' }), '').hardFailures,
    ).toEqual([]);
  });

  it('returns a meaning, not its ideas payload, for a translation request', async () => {
    const generator = createFakeGenerator();

    const attempt = await generator.complete(
      assembleTranslationInstruction(),
      '履歷第一行就要說清楚你解決過什麼問題。',
      abortableOptions('translation'),
    );

    expect(attempt.rawText).not.toContain('"ideas"');
    const parsed = parseTranslationOutput(attempt.rawText);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // Whatever this says is saved to the session and shown as the owner's meaning,
    // so it has to announce itself as a stand-in rather than read like one.
    expect(parsed.value.english_meaning).toMatch(/example/i);
  });

  it('is deterministic across calls for the same task', async () => {
    const generator = createFakeGenerator();
    const instruction = assembleRewriteInstruction('shorter', [], { requireEnglishMeaning: false });

    const first = await generator.complete(instruction, 'One draft.', abortableOptions('rewrite'));
    const second = await generator.complete(instruction, 'Another draft entirely.', abortableOptions('rewrite'));

    expect(first.rawText).toBe(second.rawText);
  });

  it('still returns three ideas when the ideas task is the one being asked', async () => {
    const generator = createFakeGenerator();
    const attempt = await generator.complete('Write reply suggestions.', 'A post about cover letters.', abortableOptions('ideas'));

    expect(attempt.rawText).toContain('"ideas"');
  });
});

describe('a rewrite is judged against the owner’s own words (C06)', () => {
  const ownerClaim = 'I led hiring at a mid-sized firm and saw 40 of these a week.';

  it('does not withhold a claim the owner wrote themselves', () => {
    // C06: "user-written final text is never silently corrected by the
    // generator", and issue #14 repeats it. Checking a rewrite only against the
    // approved facts would hand the owner their own sentence back as a refusal
    // the moment they pressed Shorter.
    const report = checkRewrite(
      { revised_text: ownerClaim, english_meaning: null, uses_fact_ids: [] },
      'shorter',
      context(),
      ownerClaim,
    );

    expect(report.hardFailures).toEqual([]);
  });

  it('still withholds a claim the rewrite invented', () => {
    const invented = 'I led hiring at a mid-sized firm and saw 900 of these a week.';

    const report = checkRewrite(
      { revised_text: invented, english_meaning: null, uses_fact_ids: [] },
      'shorter',
      context(),
      ownerClaim,
    );

    // The first-person claim was already the owner's, so that part passes. The
    // figure is new, and a rewrite is not a licence to make one up.
    expect(report.hardFailures.map((failure) => failure.code)).toContain('unsupported_number');
  });

  it('still withholds a link, whatever the owner wrote', () => {
    const report = checkRewrite(
      {
        revised_text: `${ownerClaim} See https://evil.example.com/thing.`,
        english_meaning: null,
        uses_fact_ids: [],
      },
      'shorter',
      context(),
      ownerClaim,
    );

    expect(report.hardFailures.map((failure) => failure.code)).toContain('raw_url');
  });

  it('withholds a first-person claim when there is no baseline to justify it', () => {
    const report = checkRewrite(
      { revised_text: ownerClaim, english_meaning: null, uses_fact_ids: [] },
      'shorter',
      context(),
      'A draft with no personal claim in it at all.',
    );

    expect(report.hardFailures.map((failure) => failure.code)).toContain(
      'unsupported_first_person',
    );
  });
});

