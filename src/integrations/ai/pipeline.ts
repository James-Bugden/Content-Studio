import 'server-only';
import { isAppError, type ErrorCode } from '@/domain/errors';
import { emit } from '@/observability/events';
import type { AiMeta, AiResult, AiTask } from '@/application/ports';

/**
 * Provider-neutral run loop shared by the Anthropic and fake gateways (AI-01, OBS-03).
 *
 * call -> refusal/truncation check -> JSON.parse -> schema -> normalise -> validate,
 * with at most ONE repair request that lists problems by path only. Exactly one
 * telemetry event is emitted per run, carrying task, model, prompt version, token
 * counts, duration and the error code: never copy, prompts or provider payloads.
 */
export type ModelTurn = { role: 'user' | 'assistant'; content: string };

export type ModelReply = {
  stopReason: 'end_turn' | 'max_tokens' | 'refusal' | 'other';
  /** Concatenated text blocks, or null when there were none. */
  text: string | null;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
};

export type ModelRequest = {
  system: string;
  messages: ModelTurn[];
  maxOutputTokens: number;
  attempt: 0 | 1;
};

/** Throws AppError (mapped provider failure) or a cancellation marker. */
export type ModelCaller = (req: ModelRequest, signal: AbortSignal | undefined) => Promise<ModelReply>;

export class AiCancelled extends Error {
  constructor() {
    super('cancelled');
    this.name = 'AiCancelled';
  }
}

export const REPAIR_PREFIX = 'Your previous reply could not be accepted. Problems, by path:';

function schemaProblems(issues: readonly { path: readonly PropertyKey[]; code: string }[]): string[] {
  return issues.slice(0, 20).map((i) => `${i.path.length ? i.path.map(String).join('.') : '(root)'}: ${i.code}`);
}

export async function runTask<T, I>(
  base: { provider: AiMeta['provider']; model: string },
  task: AiTask<T, I>,
  input: I,
  call: ModelCaller,
  opts: { signal?: AbortSignal } = {},
): Promise<AiResult<T>> {
  const started = performance.now();
  let model = base.model;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let repaired = false;
  const meta = (extra: Partial<AiMeta> = {}): AiMeta => ({
    provider: base.provider,
    model,
    promptVersion: task.promptVersion,
    durationMs: Math.round(performance.now() - started),
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    repaired,
    ...extra,
  });
  const finish = (result: AiResult<T>, facts: Record<string, string | number | boolean> = {}): AiResult<T> => {
    emit({
      name: 'ai.run',
      adapter: 'ai',
      outcome: result.ok ? 'ok' : 'error',
      latencyMs: result.meta.durationMs,
      retries: repaired ? 1 : 0,
      ...(result.ok ? {} : { code: result.code }),
      facts: {
        task: task.name,
        provider: base.provider,
        model,
        promptVersion: task.promptVersion,
        inputTokens: inputTokens ?? 0,
        outputTokens: outputTokens ?? 0,
        repaired,
        ...facts,
      },
    });
    return result;
  };
  const fail = (code: ErrorCode, facts: Record<string, string | number | boolean> = {}, extra: Partial<AiMeta> = {}) =>
    finish({ ok: false, code, meta: meta(extra) }, facts);

  let prompt: string;
  try {
    prompt = task.render(input);
  } catch {
    return fail('VALIDATION_FAILED', { stage: 'render' });
  }
  const messages: ModelTurn[] = [{ role: 'user', content: prompt }];

  for (const attempt of [0, 1] as const) {
    if (opts.signal?.aborted) return fail('PROVIDER_UNAVAILABLE', { cancelled: true }, { cancelled: true });
    let reply: ModelReply;
    try {
      reply = await call({ system: task.system, messages: [...messages], maxOutputTokens: task.maxOutputTokens, attempt }, opts.signal);
    } catch (error) {
      if (error instanceof AiCancelled) return fail('PROVIDER_UNAVAILABLE', { cancelled: true }, { cancelled: true });
      return fail(isAppError(error) ? error.code : 'UNKNOWN', { stage: 'call' });
    }
    model = reply.model || model;
    if (reply.inputTokens !== undefined) inputTokens = (inputTokens ?? 0) + reply.inputTokens;
    if (reply.outputTokens !== undefined) outputTokens = (outputTokens ?? 0) + reply.outputTokens;
    if (opts.signal?.aborted) return fail('PROVIDER_UNAVAILABLE', { cancelled: true }, { cancelled: true });
    if (reply.stopReason === 'refusal') return fail('PROVIDER_UNAVAILABLE', { refusal: true });

    let problems: string[] = [];
    let value: T | undefined;
    if (reply.stopReason === 'max_tokens') {
      problems = ['(root): output was truncated; reply more concisely'];
    } else if (reply.text === null || reply.text.trim() === '') {
      problems = ['(root): empty reply'];
    } else {
      let parsed: unknown;
      try {
        parsed = JSON.parse(reply.text);
      } catch {
        problems = ['(root): not valid JSON'];
      }
      if (problems.length === 0) {
        const checked = task.schema.safeParse(parsed);
        if (!checked.success) {
          problems = schemaProblems(checked.error.issues);
        } else {
          value = task.normalise ? task.normalise(checked.data, input) : checked.data;
          problems = task.validate ? task.validate(value, input) : [];
        }
      }
    }

    if (problems.length === 0 && value !== undefined) return finish({ ok: true, value, meta: meta() });
    if (attempt === 1) return fail('VALIDATION_FAILED', { problems: problems.length });

    repaired = true;
    messages.push({ role: 'assistant', content: reply.text?.trim() ? reply.text : '(no usable output)' });
    messages.push({
      role: 'user',
      content: `${REPAIR_PREFIX}\n${problems.map((p) => `- ${p}`).join('\n')}\nReturn the complete corrected JSON only, following the same rules.`,
    });
  }
  return fail('UNKNOWN');
}
