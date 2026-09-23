import 'server-only';
import { shortHash } from '@/domain/hash';
import type { ErrorCode } from '@/domain/errors';

/**
 * Redacted structured telemetry (MASTER-SPEC section 8, OBS-02..OBS-06).
 *
 * An event carries operation/request ids, adapter, outcome, latency, retry count
 * and a *hash* of the target id. It never carries post copy, Markdown, private
 * Drive names or URLs, tokens or owner identifiers. The schema is closed: a field
 * that is not declared here cannot be logged, which is what makes redaction
 * provable rather than a matter of discipline.
 */
export type TelemetryEvent = {
  name: string;
  adapter: 'sheet' | 'drive' | 'typefully' | 'ai' | 'auth' | 'app';
  outcome: 'ok' | 'error' | 'conflict' | 'blocked' | 'replayed' | 'partial';
  operationId?: string;
  latencyMs?: number;
  retries?: number;
  /** Hash of the stable target id, never the id itself. */
  targetHash?: string;
  code?: ErrorCode;
  httpStatus?: number;
  /** Small closed-vocabulary facts, e.g. { tab: 'library', fields: 3 }. Strings are length-capped enums/ids only. */
  facts?: Record<string, string | number | boolean>;
};

export type TelemetrySink = (event: TelemetryEvent & { at: string }) => void;

const SAFE_FACT = /^[A-Za-z0-9 _./:-]{0,64}$/;

function stdoutSink(event: TelemetryEvent & { at: string }): void {
  if (process.env.CS_TEST_MODE === 'unit') return;
  process.stdout.write(`${JSON.stringify({ level: event.outcome === 'ok' ? 'info' : 'warn', ...event })}\n`);
}

let sink: TelemetrySink = stdoutSink;
const recent: (TelemetryEvent & { at: string })[] = [];
const RECENT_MAX = 500;

export function setTelemetrySink(next: TelemetrySink | null): void {
  sink = next ?? stdoutSink;
}

/** Recent events in this server instance, for the reconciliation/health views. */
export function recentEvents(): readonly (TelemetryEvent & { at: string })[] {
  return recent;
}

export function targetHash(id: string): string {
  return shortHash(`target:${id}`);
}

/** Drops any fact value that is not a short safe token. */
export function redactFacts(facts: TelemetryEvent['facts']): TelemetryEvent['facts'] {
  if (!facts) return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(facts)) {
    if (!SAFE_FACT.test(key)) continue;
    if (typeof value === 'string') out[key] = SAFE_FACT.test(value) ? value : '[redacted]';
    else if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    else if (typeof value === 'boolean') out[key] = value;
  }
  return out;
}

export function emit(event: TelemetryEvent): void {
  const safe = {
    name: SAFE_FACT.test(event.name) ? event.name : 'event',
    adapter: event.adapter,
    outcome: event.outcome,
    ...(event.operationId && /^[A-Za-z0-9_-]{8,80}$/.test(event.operationId) ? { operationId: event.operationId } : {}),
    ...(typeof event.latencyMs === 'number' ? { latencyMs: Math.round(event.latencyMs) } : {}),
    ...(typeof event.retries === 'number' ? { retries: event.retries } : {}),
    ...(event.targetHash && /^[0-9a-f]{8}$/.test(event.targetHash) ? { targetHash: event.targetHash } : {}),
    ...(event.code ? { code: event.code } : {}),
    ...(typeof event.httpStatus === 'number' ? { httpStatus: event.httpStatus } : {}),
    ...(event.facts ? { facts: redactFacts(event.facts) } : {}),
    at: new Date().toISOString(),
  } satisfies TelemetryEvent & { at: string };
  recent.push(safe);
  if (recent.length > RECENT_MAX) recent.shift();
  try {
    sink(safe);
  } catch {
    // Telemetry must never break a request.
  }
}

/** Time an async step and emit one event for it. */
export async function timed<T>(
  base: Omit<TelemetryEvent, 'outcome' | 'latencyMs'>,
  fn: () => Promise<T>,
  classify: (value: T) => TelemetryEvent['outcome'] = () => 'ok',
): Promise<T> {
  const started = performance.now();
  try {
    const value = await fn();
    emit({ ...base, outcome: classify(value), latencyMs: performance.now() - started });
    return value;
  } catch (error) {
    const code = (error as { code?: ErrorCode }).code;
    emit({ ...base, outcome: 'error', latencyMs: performance.now() - started, ...(code ? { code } : {}) });
    throw error;
  }
}
