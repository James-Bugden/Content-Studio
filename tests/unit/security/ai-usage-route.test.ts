import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ requireActor: vi.fn(), requireMutation: vi.fn(), summary: vi.fn(), setCap: vi.fn() }));
vi.mock('@/lib/auth', () => ({ requireActor: mocks.requireActor, requireMutation: mocks.requireMutation }));
vi.mock('@/application/ai-usage-container', () => ({ getAiUsage: () => ({ summary: mocks.summary, setCap: mocks.setCap }) }));
import { GET, PATCH } from '@/app/api/ai-usage/route';
import { AppError } from '@/domain/errors';
beforeEach(() => { vi.resetAllMocks(); mocks.requireActor.mockResolvedValue({ sub: 'synthetic-owner', role: 'owner' }); mocks.requireMutation.mockResolvedValue({ sub: 'synthetic-owner', role: 'owner' }); });
const request = (data: unknown) => new Request('http://localhost:3000/api/ai-usage', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' }, body: JSON.stringify(data) });
it('owner checks guard reads and same-origin mutations before touching storage', async () => {
  mocks.requireActor.mockRejectedValue(new AppError('FORBIDDEN'));
  expect((await GET()).status).toBe(403); expect(mocks.summary).not.toHaveBeenCalled();
  mocks.requireMutation.mockRejectedValue(new AppError('FORBIDDEN'));
  expect((await PATCH(request({}))).status).toBe(403); expect(mocks.setCap).not.toHaveBeenCalled();
});
it('validates cap/revision/operation, hashes the actor and never caches private usage', async () => {
  expect((await PATCH(request({ capMicros: -1 }))).status).toBe(400);
  expect(mocks.setCap).not.toHaveBeenCalled();
  const change = { capMicros: 0, expectedVersion: 1, operationId: '00000000-0000-4000-8000-000000000001' };
  expect((await PATCH(request(change))).status).toBe(200);
  expect(mocks.setCap).toHaveBeenCalledWith({ ...change, actorHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
  mocks.summary.mockResolvedValue({ spentMicros: 0 });
  const result = await GET(); expect(result.headers.get('Cache-Control')).toContain('private, no-store');
});
