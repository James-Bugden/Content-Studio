import 'server-only';
import type { Capability } from '@/domain/capability';
import { AppError, type ErrorCode } from '@/domain/errors';
import type { AiGateway, AiResult, AiTask, AiTaskName } from '@/application/ports';
import type { EnglishQaInput } from '@/application/english-qa';
import type { HookInput } from '@/application/hooks';
import type { ZhInput } from '@/application/zh-tw';
import { fakeEnglishQa, fakeHooks, fakeZhTw } from './fake-generators';
import { AiCancelled, runTask, type ModelCaller } from './pipeline';

/**
 * Deterministic AI gateway: no network, no key. Used in fake mode, unit tests and
 * e2e. Fault injection covers the provider failure modes the UI must survive:
 *
 * - `failNext(code)`: the next run fails with that code before any model call.
 * - `malformedNext(times)`: the next `times` model calls return bad output
 *   (alternately invalid JSON and schema-valid but out-of-range data), exercising
 *   the one bounded repair (AI-01).
 * - `delayMs`: simulated latency, cancellable through the caller's signal.
 */
export const FAKE_MODEL = 'fake-deterministic-v1';

export class FakeAiGateway implements AiGateway {
  delayMs = 0;
  private failures: ErrorCode[] = [];
  private malformed = 0;
  private malformedServed = 0;
  /** Every request the fake received (system + messages), for prompt assertions in tests. */
  readonly requests: { task: AiTaskName; system: string; messages: { role: string; content: string }[] }[] = [];

  capability(): Capability {
    return { provider: 'ai', mode: 'fake', state: 'ready' };
  }

  failNext(code: ErrorCode): void {
    this.failures.push(code);
  }

  malformedNext(times = 1): void {
    this.malformed += times;
  }

  private async wait(signal?: AbortSignal): Promise<void> {
    if (this.delayMs <= 0) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, this.delayMs);
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(new AiCancelled());
        },
        { once: true },
      );
    });
  }

  private generate(name: AiTaskName, input: unknown): unknown {
    switch (name) {
      case 'english_qa':
        return fakeEnglishQa(input as EnglishQaInput);
      case 'hooks':
        return fakeHooks(input as HookInput);
      case 'zh_tw':
        return fakeZhTw(input as ZhInput);
      case 'zh_qa':
        throw new AppError('CONFIG_MISSING', { reason: 'no_fake_for_task' });
    }
  }

  /** Bad output for the repair path: invalid JSON first, then out-of-range data. */
  private malformedOutput(name: AiTaskName, input: unknown): string {
    this.malformedServed += 1;
    if (this.malformedServed % 2 === 1) return '{"findings": [ this is not json';
    if (name === 'english_qa') {
      const d = (input as EnglishQaInput).draft;
      return JSON.stringify({
        findings: [
          { id: 'f1', category: 'spelling', start: d.length + 5, end: d.length + 9, original: '\u0000none', replacement: 'x', explanation: 'Out of range.', severity: 'must' },
          { id: 'f1', category: 'spelling', start: 0, end: 1, original: d.slice(0, 1), replacement: 'x', explanation: 'Duplicate id.', severity: 'must' },
        ],
        summary: 'Malformed on purpose.',
      });
    }
    if (name === 'hooks') return JSON.stringify({ alternatives: (fakeHooks(input as HookInput).alternatives).slice(0, 2) });
    if (name === 'zh_tw') return JSON.stringify({ ...fakeZhTw(input as ZhInput), content: '这是简体' });
    return '{}';
  }

  async run<T, I>(task: AiTask<T, I>, input: I, opts: { signal?: AbortSignal } = {}): Promise<AiResult<T>> {
    const injected = this.failures.shift();
    const call: ModelCaller = async (req, signal) => {
      this.requests.push({ task: task.name, system: req.system, messages: req.messages.map((m) => ({ ...m })) });
      await this.wait(signal);
      if (injected) throw new AppError(injected, { provider: 'ai', injected: true });
      const text = this.malformed > 0 ? (this.malformed--, this.malformedOutput(task.name, input)) : JSON.stringify(this.generate(task.name, input));
      return { stopReason: 'end_turn', text, model: FAKE_MODEL, inputTokens: Math.ceil(req.messages.reduce((n, m) => n + m.content.length, 0) / 4), outputTokens: Math.ceil(text.length / 4) };
    };
    return runTask({ provider: 'fake', model: FAKE_MODEL }, task, input, call, opts);
  }
}

/** AI is optional: without configuration every run is CONFIG_MISSING and manual work continues. */
export class UnconfiguredAiGateway implements AiGateway {
  capability(): Capability {
    return { provider: 'ai', mode: 'live', state: 'not_configured', detail: 'AI provider not configured' };
  }

  async run<T, I>(task: AiTask<T, I>): Promise<AiResult<T>> {
    return { ok: false, code: 'CONFIG_MISSING', meta: { provider: 'anthropic', model: 'none', promptVersion: task.promptVersion, durationMs: 0, repaired: false } };
  }
}
