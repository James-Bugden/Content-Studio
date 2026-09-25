import { createHash } from 'node:crypto';
import { MEANING_REQUIRED_LINE } from '../tasks';
import { ProviderError, type GenerationAttempt, type ReplyGenerator } from '../types';

/**
 * The fake provider (C08, C07).
 *
 * It exists so that the whole application can be built, tested and demonstrated
 * without a paid key, and so that browser journeys are deterministic. It returns
 * schema-valid output that goes through exactly the same validation, guards and
 * resource resolution as a real response.
 *
 * It is labelled. Every reply it produces says it is an example, because a fake
 * that is indistinguishable from real output is how a demo becomes a false claim.
 *
 * It answers the question it was asked. Emitting the ideas payload for every task
 * meant a rewrite request was answered with a JSON blob, and the owner was offered
 * it as a revision of their reply; the English meaning of a Chinese draft was the
 * same blob, saved to the session as what their Chinese says. Each task therefore
 * has its own stand-in, in the shape that task declares.
 */

export interface FakeBehaviour {
  /** Force a specific failure, for testing the orchestrator's recovery paths. */
  fail?: 'timeout' | 'rate_limited' | 'unavailable' | 'invalid_response';
  /** Return malformed JSON once, then valid output. Exercises the repair path. */
  malformedFirst?: boolean;
  /** Return three near-identical ideas. Exercises the differentiation check. */
  duplicateIdeas?: boolean;
  /** Omit english_meaning for a Chinese reply. Exercises the ZH validation. */
  omitMeaning?: boolean;
  /** Claim a resource id that is not in the supplied context. */
  unknownResourceId?: string;
  /** Simulated latency, in milliseconds. */
  latencyMs?: number;
  retryAfterSeconds?: number;
}

const ENGLISH_SHAPES = [
  {
    label: 'Direct answer',
    body: (topic: string) =>
      `Example reply. The short version: ${topic} matters less than most people are told. What actually moves things is being specific about the problem you solved.`,
  },
  {
    label: 'Practical next step',
    body: (topic: string) =>
      `Example reply. If you want to act on ${topic} this week, rewrite one line of your CV so it names a number and a decision. That single change gets noticed more than a rewrite.`,
  },
  {
    label: 'Recruiter perspective',
    // Two paragraphs on purpose: real replies have line breaks, and a stand-in
    // with none is how a display that collapsed them went unnoticed.
    body: (topic: string) =>
      `Example reply. From the hiring side, ${topic} is rarely the thing that decides it.\n\nThe shortlist usually turns on whether the first two lines answer the question the role is asking.`,
  },
];

const CHINESE_SHAPES = [
  {
    label: '直接回應',
    body: (topic: string) => `範例回覆。關於${topic}，重點其實不在技巧，而在你能不能具體說出自己解決過什麼問題。`,
    meaning: (topic: string) =>
      `Example reply. On ${topic}, the point is not technique but whether you can say concretely what problem you solved.`,
  },
  {
    label: '可以馬上做的一步',
    body: (topic: string) => `範例回覆。如果這週想處理${topic}，先把履歷裡的一條改成有數字、有決策的寫法就好。`,
    meaning: (topic: string) =>
      `Example reply. If you want to work on ${topic} this week, rewrite one resume bullet so it has a number and a decision.`,
  },
  {
    label: '招募端的看法',
    body: (topic: string) => `範例回覆。站在招募人員的角度，${topic}很少是決定性的因素，前兩行有沒有回答職缺說明的問題才是。`,
    meaning: (topic: string) =>
      `Example reply. From a recruiter's side, ${topic} is rarely decisive. What matters is whether the first two lines answer what the job description asks.`,
  },
];

/**
 * Stand-ins for the single-answer tasks.
 *
 * Deliberately fixed rather than derived from the draft. Echoing the owner's own
 * sentences back at them would read like a real revision, and a stand-in that reads
 * like a real revision is the thing this provider exists not to be.
 */
const REWRITE_EXAMPLE = {
  english:
    'Example rewrite. This is a stand-in from the fake provider. It shows the shape of a revision rather than being one.',
  chinese: '範例改寫。這是假提供者產生的佔位文字，只用來讓你看見改寫的格式。',
  chineseMeaning:
    'Example rewrite. This is placeholder text from the fake provider, shown only so you can see the shape of a revision.',
} as const;

const TRANSLATION_EXAMPLE =
  'Example meaning. The fake provider does not read the draft, so this stands in for the English rather than describing what was written.';

/** A short, stable stand-in for the subject of the source post. */
function topicOf(userContent: string): string {
  const words = userContent
    .replace(/<[^>]*>/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 4 && /^[\p{L}]+$/u.test(w));
  return words[0]?.toLowerCase() ?? 'this';
}

export function createFakeGenerator(behaviour: FakeBehaviour = {}): ReplyGenerator {
  let attempt = 0;

  return {
    name: 'fake',
    model: 'fake',
    async complete(instruction, userContent, options): Promise<GenerationAttempt> {
      attempt += 1;
      const started = Date.now();

      if (behaviour.latencyMs) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, behaviour.latencyMs);
          options.signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new ProviderError('timeout', 'The attempt deadline passed.'));
          });
        });
      }

      if (behaviour.fail === 'rate_limited') {
        throw new ProviderError('rate_limited', 'Rate limited.', behaviour.retryAfterSeconds ?? 5);
      }
      if (behaviour.fail) {
        throw new ProviderError(behaviour.fail, `Simulated ${behaviour.fail}.`);
      }

      if (behaviour.malformedFirst && attempt === 1) {
        return {
          rawText: '{"ideas": [ {"position": 0, "reply_text": "unterminated',
          usage: { inputTokens: 100, outputTokens: 20, durationMs: Date.now() - started },
          model: 'fake',
          provider: 'fake',
        };
      }

      const finish = (payload: unknown): GenerationAttempt => ({
        rawText: JSON.stringify(payload),
        usage: {
          // Deterministic, so a test can assert on usage without a live call.
          inputTokens: Math.min(6_000, Math.ceil(userContent.length / 4)),
          outputTokens: Math.ceil(JSON.stringify(payload).length / 4),
          durationMs: Date.now() - started,
        },
        model: 'fake',
        provider: 'fake',
      });

      if (options.task === 'translation') {
        return finish({ english_meaning: TRANSLATION_EXAMPLE });
      }

      if (options.task === 'rewrite') {
        const needsMeaning = instruction.includes(MEANING_REQUIRED_LINE);
        return finish({
          revised_text: needsMeaning ? REWRITE_EXAMPLE.chinese : REWRITE_EXAMPLE.english,
          english_meaning: needsMeaning ? REWRITE_EXAMPLE.chineseMeaning : null,
          // No approved fact is ever leaned on, so the stand-in stays groundable
          // whatever context it is asked to revise in.
          uses_fact_ids: [],
        });
      }

      const wantsChinese = instruction.includes('Taiwan Traditional Chinese');
      const topic = topicOf(userContent);
      const shapes = wantsChinese ? CHINESE_SHAPES : ENGLISH_SHAPES;

      const ideas = [0, 1, 2].map((position) => {
        const shape = behaviour.duplicateIdeas ? shapes[0]! : shapes[position]!;
        const chinese = wantsChinese ? (shape as (typeof CHINESE_SHAPES)[number]) : null;
        return {
          position,
          angle_label: behaviour.duplicateIdeas ? shapes[0]!.label : shape.label,
          reply_text: shape.body(topic),
          english_meaning:
            chinese && !behaviour.omitMeaning ? chinese.meaning(topic) : null,
          resource_id: position === 0 ? (behaviour.unknownResourceId ?? null) : null,
          cta_text: null,
          uses_fact_ids: [],
          based_on_reply_ids: [],
        };
      });

      return finish({ ideas });
    },
  };
}

/** Stable identity for a fake run, so golden tests can pin it. */
export function fakeRunFingerprint(userContent: string): string {
  return createHash('sha256').update(userContent, 'utf8').digest('hex').slice(0, 12);
}

