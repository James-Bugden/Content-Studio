import { afterEach, expect, it, vi } from 'vitest';
import { AppError } from '@/domain/errors';
import { FakeSheetTransport } from '@/integrations/google/fake-sheet';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';
import { SHEET_TABS } from '@/domain/sheet-schema';

afterEach(() => vi.restoreAllMocks());

it.each(['RATE_LIMITED', 'PROVIDER_UNAVAILABLE'] as const)('selects last good data only for %s without more reads; retry recovers', async (code) => {
  const transport = new FakeSheetTransport();
  const repo = new SheetsContentRepository(transport);
  const good = await repo.listLibrary();
  transport.failNext({ op: 'read', code });
  await expect(repo.listLibrary()).rejects.toMatchObject({ code });
  expect(repo.lastGoodLibrary(new AppError(code))).toEqual({ rows: good, readAt: expect.any(Number) });
  expect(transport.reads).toBe(2);
  expect(await repo.listLibrary()).toEqual(good);
  expect(transport.reads).toBe(3);
});

it('does not recover cold starts, other errors, or snapshots five minutes old', async () => {
  const transport = new FakeSheetTransport();
  const repo = new SheetsContentRepository(transport);
  const failure = new AppError('RATE_LIMITED');
  transport.failNext({ op: 'read', code: 'RATE_LIMITED' });
  await expect(repo.listLibrary()).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  expect(repo.lastGoodLibrary(failure)).toBeNull();
  const now = vi.spyOn(Date, 'now').mockReturnValue(100);
  await repo.listLibrary();
  for (const code of ['SCHEMA_DRIFT', 'FORBIDDEN', 'AUTH_REQUIRED', 'UNKNOWN'] as const) {
    expect(repo.lastGoodLibrary(new AppError(code))).toBeNull();
  }
  expect(repo.lastGoodLibrary(new Error('unexpected'))).toBeNull();
  now.mockReturnValue(300_100);
  expect(repo.lastGoodLibrary(failure)).toBeNull();
});

it('never uses fallback for a mutation, and fresh preconditions invalidate last-good data', async () => {
  const transport = new FakeSheetTransport();
  const repo = new SheetsContentRepository(transport);
  const [record] = await repo.listLibrary();
  transport.failNext({ op: 'read', code: 'PROVIDER_UNAVAILABLE' });
  const result = await repo.updateLibrary({
    operationId: 'op_stale_read_127', actor: { sub: 'synthetic-owner', role: 'owner' },
    target: { libraryId: record!.value.libraryId }, expectedRevision: record!.revision,
    patch: { draftContent: 'Synthetic proposed copy' },
  });
  expect(result).toMatchObject({ ok: false, code: 'PROVIDER_UNAVAILABLE' });
  expect(transport.writes).toHaveLength(0);
  expect(repo.lastGoodLibrary(new AppError('PROVIDER_UNAVAILABLE'))).toBeNull();
});

it('recovers after the live display TTL expires without extending last-good age on failures', async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(100);
  const transport = new FakeSheetTransport();
  const repo = new SheetsContentRepository(transport, { writable: true, readCacheMs: 15_000 });
  const good = await repo.listLibrary();
  now.mockReturnValue(15_100);
  transport.failNext({ op: 'read', code: 'RATE_LIMITED', times: 2 });
  await expect(repo.listLibrary()).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  expect(repo.lastGoodLibrary(new AppError('RATE_LIMITED'))).toEqual({ rows: good, readAt: 100 });
  now.mockReturnValue(300_100);
  await expect(repo.listLibrary()).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  expect(repo.lastGoodLibrary(new AppError('RATE_LIMITED'))).toBeNull();
  expect(transport.reads).toBe(3);
});

it('distinguishes a genuinely empty cached Library from no prior good read', async () => {
  const transport = new FakeSheetTransport();
  transport.rawTab(SHEET_TABS.library.name).splice(1);
  const repo = new SheetsContentRepository(transport);
  expect(await repo.listLibrary()).toEqual([]);
  expect(repo.lastGoodLibrary(new AppError('RATE_LIMITED'))).toEqual({ rows: [], readAt: expect.any(Number) });
});
