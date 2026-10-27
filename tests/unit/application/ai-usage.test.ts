import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { AiUsageService, estimatedAiCost } from '@/application/ai-usage';
import { FakeAiUsageRepository } from '@/integrations/supabase/fake-ai-usage';
import { aiMonth, aiUsageLevel } from '@/domain/ai-usage';
import { FakeAiGateway } from '@/integrations/ai/fake-gateway';
import { ENGLISH_QA_TASK as englishQaTask } from '@/application/english-qa';

const actorHash = 'a'.repeat(64);
describe('AI costs and calendar', () => {
  it('calculates integer USD microdollars and rounds sub-micro costs up', () => {
    expect(estimatedAiCost('claude-opus-5', 1_000_000, 1_000_000)).toBe(30_000_000);
    expect(estimatedAiCost('claude-sonnet-5', 1200, 300)).toBe(5400);
    expect(estimatedAiCost('claude-haiku-4-5-20251001', 100, 10)).toBe(150);
    expect(estimatedAiCost('text-embedding-3-small', 1, 0)).toBe(1);
    expect(() => estimatedAiCost('unpriced-model', 100, 100)).toThrow();
    for (const n of [-1, NaN, Infinity, 1.5]) expect(() => estimatedAiCost('claude-opus-5', n, 1)).toThrow();
  });
  it('warns at exactly 80%, blocks at/over cap, and zero pauses all AI', () => {
    expect(aiUsageLevel(15_999_999, 20_000_000)).toBe('normal');
    expect(aiUsageLevel(16_000_000, 20_000_000)).toBe('warning');
    expect(aiUsageLevel(19_999_999, 20_000_000)).toBe('warning');
    expect(aiUsageLevel(20_000_000, 20_000_000)).toBe('blocked');
    expect(aiUsageLevel(20_000_001, 20_000_000)).toBe('blocked');
    expect(aiUsageLevel(0, 0)).toBe('blocked');
  });
  it('uses Taipei midnight on the first, including the December rollover', () => {
    expect(aiMonth(new Date('2026-12-31T15:59:59Z'))).toEqual({ month: '2026-12', resetsAt: '2026-12-31T16:00:00.000Z' });
    expect(aiMonth(new Date('2026-12-31T16:00:00Z'))).toEqual({ month: '2027-01', resetsAt: '2027-01-31T16:00:00.000Z' });
  });
});

describe('AI usage admission and settlement', () => {
  it.each([20_000_000, 20_000_001])('refuses before calling the provider at spend %s', async costMicros => {
    const repo = new FakeAiUsageRepository();
    await repo.begin({ id: randomUUID(), feature: 'hooks', model: 'fake', inputTokens: 1, outputTokens: 1, costMicros });
    const provider = vi.fn();
    await expect(new AiUsageService(repo).track('hooks', 'fake', 1, 1, provider, () => ({ model: 'fake' }))).rejects.toMatchObject({ code: 'AI_LIMIT_REACHED' });
    expect(provider).not.toHaveBeenCalled(); expect(repo.calls).toHaveLength(1);
  });
  it('resets spend at month rollover without clearing history or the saved cap', async () => {
    let now = new Date('2026-10-31T15:59:59Z');
    const repo = new FakeAiUsageRepository(() => now);
    await repo.setCap({ operationId: randomUUID(), expectedVersion: 1, capMicros: 10, actorHash });
    await repo.begin({ id: randomUUID(), feature: 'hooks', model: 'fake', inputTokens: 1, outputTokens: 1, costMicros: 10 });
    expect((await repo.summary()).spentMicros).toBe(10);
    now = new Date('2026-10-31T16:00:00Z');
    expect(await repo.summary()).toMatchObject({ month: '2026-11', spentMicros: 0, capMicros: 10 });
    expect((await repo.summary()).calls).toHaveLength(1);
  });
  it('counts each repair and rejected provider response before output validation', async () => {
    const repo = new FakeAiUsageRepository();
    const ai = new FakeAiGateway(new AiUsageService(repo)); ai.malformedNext(2);
    const result = await ai.run(englishQaTask, { draft: 'Synthetic color.', platform: 'X' });
    expect(result.ok).toBe(false); expect(ai.requests).toHaveLength(2);
    expect(repo.calls).toHaveLength(2);
    expect(repo.calls.every(c => c.status === 'completed' && c.inputTokens > 0 && c.outputTokens > 0 && c.costMicros > 0)).toBe(true);
  });
  it('rechecks cap before a repair call', async () => {
    const repo = new FakeAiUsageRepository();
    await repo.setCap({ operationId: randomUUID(), expectedVersion: 1, capMicros: 1, actorHash });
    const ai = new FakeAiGateway(new AiUsageService(repo)); ai.malformedNext(2);
    expect(await ai.run(englishQaTask, { draft: 'Synthetic color.', platform: 'X' })).toMatchObject({ ok: false, code: 'AI_LIMIT_REACHED' });
    expect(ai.requests).toHaveLength(1); expect(repo.calls).toHaveLength(1);
  });
  it('includes in-flight calls across concurrent admissions, and settles once', async () => {
    const repo = new FakeAiUsageRepository();
    await repo.setCap({ operationId: randomUUID(), expectedVersion: 1, capMicros: 30, actorHash });
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const provider = vi.fn(async () => { await pending; return { model: 'fake', inputTokens: 1, outputTokens: 1 }; });
    const service = new AiUsageService(repo);
    const first = service.track('hooks', 'fake', 1, 1, provider, x => x);
    await expect(service.track('hooks', 'fake', 1, 1, provider, x => x)).rejects.toMatchObject({ code: 'AI_LIMIT_REACHED' });
    release(); await first;
    expect(provider).toHaveBeenCalledTimes(1); expect((await repo.summary()).spentMicros).toBe(30);
    const { timestamp: _timestamp, feature: _feature, ...settled } = repo.calls[0]!;
    await repo.finish(settled); expect((await repo.summary()).spentMicros).toBe(30);
    await expect(repo.finish({ ...settled, costMicros: 0 })).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('keeps an auditable conservative estimate when billing is unknown, and fails closed on storage errors', async () => {
    const repo = new FakeAiUsageRepository();
    const service = new AiUsageService(repo);
    await expect(service.track('hooks', 'fake', 10, 10, async () => { throw new Error('synthetic timeout'); }, () => ({ model: 'fake' }))).rejects.toThrow('synthetic timeout');
    expect(repo.calls[0]).toMatchObject({ status: 'uncertain', costMicros: 300 });
    const provider = vi.fn();
    vi.spyOn(repo, 'begin').mockRejectedValue(new Error('synthetic DB failure'));
    await expect(service.track('hooks', 'fake', 1, 1, provider, () => ({ model: 'fake' }))).rejects.toThrow();
    expect(provider).not.toHaveBeenCalled();
  });
  it('cap edits use optimistic concurrency and idempotent audit operations', async () => {
    const repo = new FakeAiUsageRepository();
    const change = { operationId: randomUUID(), expectedVersion: 1, capMicros: 10, actorHash };
    await repo.setCap(change); await repo.setCap(change);
    expect(await repo.summary()).toMatchObject({ capMicros: 10, version: 2 });
    await expect(repo.setCap({ ...change, capMicros: 20 })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(repo.setCap({ ...change, operationId: randomUUID() })).rejects.toMatchObject({ code: 'STALE_READ' });
  });
});
