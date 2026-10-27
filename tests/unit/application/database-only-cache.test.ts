import { afterEach, expect, it, vi } from 'vitest';
import { databaseOnlyRepository } from '@/application/database-only';
import { SupabaseContentRepository } from '@/integrations/supabase/content-repository';
import { FakeContentDb } from '@/integrations/supabase/fake-content-db';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it('coalesces display reads, expires them, and evicts rejected reads', async () => {
  vi.useFakeTimers();
  const db = new FakeContentDb(), read = vi.spyOn(db, 'listPosts');
  const repo = databaseOnlyRepository(new SupabaseContentRepository(db), true);
  await Promise.all([repo.listLibrary(), repo.listLibrary(), repo.listLibrary()]);
  expect(read).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(3_001);
  read.mockRejectedValueOnce(new Error('Synthetic DB outage'));
  await expect(repo.listLibrary()).rejects.toThrow('Synthetic DB outage');
  expect((await repo.listLibrary()).length).toBeGreaterThan(0);
  expect(read).toHaveBeenCalledTimes(3);
});

it('keeps point reads fresh and clears cached lists after successful and failed mutations', async () => {
  const db = new FakeContentDb(), underlying = new SupabaseContentRepository(db);
  const read = vi.spyOn(underlying, 'listLibrary'), point = vi.spyOn(db, 'getPost');
  const repo = databaseOnlyRepository(underlying, true);
  await repo.listLibrary();
  const row = await repo.getLibrary('SYN-L001'); await repo.getLibrary('SYN-L001');
  expect(point).toHaveBeenCalledTimes(2);
  const input = { operationId: 'synthetic_cache_save', actor: { sub: 'synthetic-owner', role: 'owner' as const }, target: { libraryId: 'SYN-L001' },
    expectedRevision: row.revision, patch: { currentHook: 'Synthetic updated cache' } };
  expect(await repo.updateLibrary(input)).toMatchObject({ ok: true });
  expect((await repo.listLibrary()).find(r => r.value.libraryId === 'SYN-L001')?.value.currentHook).toBe(input.patch.currentHook);
  expect(await repo.updateLibrary({ ...input, operationId: 'synthetic_failed_cache_save', patch: { currentHook: 'Synthetic stale change' } })).toMatchObject({ ok: false, code: 'STALE_READ' });
  await repo.listLibrary(); expect(read).toHaveBeenCalledTimes(3);
});

it('fences a pending read before a write and another begun during the write', async () => {
  const underlying = new SupabaseContentRepository(new FakeContentDb());
  const oldRows = await underlying.listLibrary();
  let finishRead!: (value: typeof oldRows) => void, finishWrite!: () => void;
  const reads = vi.spyOn(underlying, 'listLibrary').mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }));
  vi.spyOn(underlying, 'updateLibrary').mockImplementationOnce(async input => {
    await new Promise<void>(resolve => { finishWrite = resolve; });
    return { ok: false, code: 'PROVIDER_UNAVAILABLE', operationId: input.operationId, steps: [] };
  });
  const repo = databaseOnlyRepository(underlying, true);
  const pending = repo.listLibrary(); await Promise.resolve();
  const save = repo.updateLibrary({ operationId: 'synthetic_pending_save', actor: { sub: 'synthetic-owner', role: 'owner' },
    target: { libraryId: 'SYN-L001' }, expectedRevision: oldRows[0]!.revision, patch: { currentHook: 'Synthetic race' } });
  await repo.listLibrary(); // A separate read during the write.
  finishRead(oldRows); await pending;
  finishWrite(); await save;
  await repo.listLibrary(); expect(reads).toHaveBeenCalledTimes(3);
});
