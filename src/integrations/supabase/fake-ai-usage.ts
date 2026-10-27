import 'server-only';
import type { AiUsageRepository } from '@/application/ai-usage';
import { aiCapSchema, aiCallSchema, aiMonth, type AiCall, type AiCapChange } from '@/domain/ai-usage';
import { AppError } from '@/domain/errors';

export class FakeAiUsageRepository implements AiUsageRepository {
  readonly calls: AiCall[] = [];
  private capMicros = 20_000_000;
  private version = 1;
  private readonly changes = new Map<string, string>();
  constructor(private readonly now: () => Date = () => new Date()) {}
  async summary() {
    const period = aiMonth(this.now());
    return { ...period, spentMicros: this.calls.filter(c => aiMonth(new Date(c.timestamp)).month === period.month).reduce((sum, c) => sum + c.costMicros, 0),
      capMicros: this.capMicros, version: this.version, calls: this.calls.slice(-25).reverse().map(c => ({ ...c })) };
  }
  async begin(call: Omit<AiCall, 'timestamp' | 'status'>) {
    // No await between the check and insert: mirrors the SQL row lock.
    const now = this.now();
    const period = aiMonth(now);
    const spent = this.calls.filter(c => aiMonth(new Date(c.timestamp)).month === period.month).reduce((sum, c) => sum + c.costMicros, 0);
    if (this.calls.some(c => c.id === call.id)) throw new AppError('CONFLICT');
    if (spent >= this.capMicros) throw new AppError('AI_LIMIT_REACHED');
    this.calls.push(aiCallSchema.parse({ ...call, timestamp: now.toISOString(), status: 'pending' }));
  }
  async finish(call: Pick<AiCall, 'id' | 'model' | 'inputTokens' | 'outputTokens' | 'costMicros' | 'status'>) {
    const current = this.calls.find(c => c.id === call.id);
    if (!current) throw new AppError('NOT_FOUND');
    const next = aiCallSchema.parse({ ...current, ...call });
    if (call.status === 'pending') throw new AppError('VALIDATION_FAILED');
    if (current.status !== 'pending' && JSON.stringify(current) !== JSON.stringify(next)) throw new AppError('CONFLICT');
    Object.assign(current, next);
  }
  async setCap(change: AiCapChange) {
    aiCapSchema.parse({ operationId: change.operationId, expectedVersion: change.expectedVersion, capMicros: change.capMicros });
    const payload = JSON.stringify(change);
    const old = this.changes.get(change.operationId);
    if (old === payload) return;
    if (old) throw new AppError('CONFLICT');
    if (change.expectedVersion !== this.version) throw new AppError('STALE_READ');
    this.capMicros = change.capMicros; this.version++;
    this.changes.set(change.operationId, payload);
  }
}
