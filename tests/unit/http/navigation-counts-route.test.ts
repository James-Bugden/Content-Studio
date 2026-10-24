import { afterEach, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/navigation-counts/route';
import { getServices, resetServices } from '@/application/container';
import { loadBoard } from '@/application/board';
import { AppError } from '@/domain/errors';
import { requireActor } from '@/lib/auth';

vi.mock('@/lib/auth', () => ({ requireActor: vi.fn() }));
afterEach(() => { resetServices(); vi.resetAllMocks(); });

it('authenticates and returns private cache-only counts with zero added adapter calls', async () => {
  const { repo, fakes } = getServices();
  const cold = await GET();
  expect(cold.status).toBe(200);
  expect(cold.headers.get('Cache-Control')).toContain('private, no-store');
  expect(await cold.json()).toMatchObject({ nextUp: null, fixIssues: null });
  expect(fakes!.sheet.reads).toBe(0);
  await loadBoard(repo);
  const before = fakes!.sheet.reads;
  const warm = await GET();
  expect((await warm.json()).nextUp).toEqual(expect.any(Number));
  expect(fakes!.sheet.reads).toBe(before);
  expect(fakes!.typefully!.calls).toHaveLength(0);
  expect(requireActor).toHaveBeenCalledWith('viewer');
});

it('refuses unauthenticated requests', async () => {
  vi.mocked(requireActor).mockRejectedValueOnce(new AppError('AUTH_REQUIRED'));
  expect((await GET()).status).toBe(401);
  expect(getServices().fakes!.sheet.reads).toBe(0);
});
