import { afterEach, describe, expect, it, vi } from 'vitest';
import { getServices, resetServices } from '@/application/container';
import { resetEnvCache } from '@/lib/env';
import { runConfiguredSheetMirror } from '@/lib/sheet-mirror-operation';
import { requireCronSecret } from '@/lib/cron-auth';
import { evidenceHash } from '@/application/sheet-mirror';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); resetServices(); resetEnvCache(); });
describe('typed import scheduling seam', () => {
  it('CS-075: lag follows fresh capture, never unchanged replay, in-progress, failed or read-only work', async () => {
    vi.stubEnv('CS_DATA_MODE', 'fake'); vi.stubEnv('CS_CONTENT_STORE', 'db-shadow'); resetEnvCache(); resetServices();
    let now = Date.UTC(2026, 9, 26);
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now);
    const services = getServices(), journal = services.contentParity!, store = services.contentImport!;
    const first = { kind: 'owner', idempotencyKey: '11111111-1111-4111-8111-111111111111' } as const;
    await runConfiguredSheetMirror(first);
    const captured = journal.lastImport!;
    now = captured + 900_001;
    vi.setSystemTime(now);
    expect(await runConfiguredSheetMirror(first)).toMatchObject({ status: 'replayed' });
    expect(journal.lastImport).toBe(captured);
    expect(journal.summary(now).lagMs).toBe(900_001);
    await services.repo.listLibrary();
    expect(journal.lastImport).toBe(captured);
    let finish!: () => void;
    const apply = store.applyImport.bind(store);
    vi.spyOn(store, 'applyImport').mockImplementationOnce(async envelope => { await new Promise<void>(resolve => { finish = resolve; }); await apply(envelope); });
    const pending = runConfiguredSheetMirror({ kind: 'scheduled' });
    // Wait until the complete source has been captured, but not yet committed.
    while (!finish) await new Promise(resolve => setTimeout(resolve, 0));
    expect(await runConfiguredSheetMirror({ kind: 'scheduled' })).toMatchObject({ status: 'in_progress' });
    expect(journal.lastImport).toBe(captured);
    vi.setSystemTime(now + 300_000);
    finish(); await pending;
    const refreshed = journal.lastImport!;
    expect(refreshed).toBe(now);
    expect(journal.summary().lagMs).toBe(300_000);
    vi.spyOn(store, 'applyImport').mockRejectedValueOnce(new Error('Synthetic import failure'));
    await expect(runConfiguredSheetMirror({ kind: 'scheduled' })).rejects.toThrow('Synthetic import failure');
    expect(journal.lastImport).toBe(refreshed);
  });
  it('uses the configured source key in the durable audit identity', async () => {
    vi.stubEnv('CS_DATA_MODE', 'fake'); vi.stubEnv('CS_CONTENT_STORE', 'db-shadow');
    vi.stubEnv('SUPABASE_READ_MODEL_SOURCE_KEY', 'synthetic_configured_source'); resetEnvCache(); resetServices();
    const apply = vi.spyOn(getServices().contentImport!, 'applyImport');
    await runConfiguredSheetMirror({ kind: 'scheduled' });
    expect(apply.mock.calls[0]![0].operationId).toMatch(/^scheduled:synthetic_configured_source:/);
    expect(apply.mock.calls[0]![0].actorHash).toBe(evidenceHash(['content-import', 'scheduled', 'synthetic_configured_source']));
  });
  it('audits owner vs scheduler, replays request keys, and makes concurrent clicks a clear no-op', async () => {
    vi.stubEnv('CS_DATA_MODE', 'fake'); vi.stubEnv('CS_CONTENT_STORE', 'db-shadow'); resetEnvCache(); resetServices();
    const services = getServices(), store = services.contentImport!;
    const apply = vi.spyOn(store, 'applyImport');
    const owner = { kind: 'owner', idempotencyKey: '11111111-1111-4111-8111-111111111111' } as const;
    const first = runConfiguredSheetMirror(owner);
    expect(await runConfiguredSheetMirror({ ...owner, idempotencyKey: '22222222-2222-4222-8222-222222222222' })).toMatchObject({ status: 'in_progress' });
    await first;
    expect(apply).toHaveBeenCalledTimes(1);
    expect(await runConfiguredSheetMirror(owner)).toMatchObject({ status: 'replayed' });
    expect(apply).toHaveBeenCalledTimes(1);
    await runConfiguredSheetMirror({ kind: 'scheduled' });
    expect(apply).toHaveBeenCalledTimes(2);
    const [a, b] = apply.mock.calls.map(c => c[0]);
    expect(a!.actorHash).toBe(evidenceHash(['content-import', 'owner', 'synthetic_workbook']));
    expect(b!.actorHash).toBe(evidenceHash(['content-import', 'scheduled', 'synthetic_workbook']));
    expect(a!.actorHash).not.toBe(b!.actorHash);
    expect(a!.operationId).toBe(`owner:synthetic_workbook:${owner.idempotencyKey}`);
    expect(b!.operationId).toMatch(/^scheduled:synthetic_workbook:/);
    await expect(runConfiguredSheetMirror({ kind: 'owner', idempotencyKey: '' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
  it('reuses the complete-snapshot operation in fake shadow mode and records safe run evidence', async () => {
    vi.stubEnv('CS_DATA_MODE', 'fake'); vi.stubEnv('CS_CONTENT_STORE', 'db-shadow'); resetEnvCache(); resetServices();
    const services = getServices();
    const result = await runConfiguredSheetMirror({ kind: 'scheduled' });
    expect(result).toMatchObject({ counts: { library: expect.any(Number) }, snapshotHash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(services.contentParity?.summary().lastRun?.snapshotHash).toBe(result.snapshotHash);
    expect(services.contentParity?.summary().lagMs).not.toBe(null);
    const dbRead = vi.spyOn(services.contentImport!.db, 'listPosts');
    await services.reconcileRepo!.listLibrary();
    expect(dbRead).toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('draft_content');
  });
  it('fails closed without cron auth and permits only the configured bearer secret', () => {
    const request = (value?: string) => new Request('https://synthetic.example/api/ops/sheet-mirror/reconcile', { headers: value ? { authorization: value } : {} });
    expect(() => requireCronSecret(request(), undefined)).toThrow();
    expect(() => requireCronSecret(request('Bearer incorrect'), 'synthetic-cron-secret')).toThrow();
    expect(() => requireCronSecret(request('Bearer synthetic-cron-secret'), 'synthetic-cron-secret')).not.toThrow();
  });
  it('records failure age and clears it only after a completed retry', async () => {
    vi.stubEnv('CS_DATA_MODE', 'fake'); vi.stubEnv('CS_CONTENT_STORE', 'db-shadow'); resetEnvCache(); resetServices();
    const services = getServices();
    vi.spyOn(services.contentImport!, 'applyImport').mockRejectedValueOnce(new Error('Synthetic failure'));
    await expect(runConfiguredSheetMirror({ kind: 'scheduled' })).rejects.toThrow('Synthetic failure');
    expect(services.contentParity?.failureSince).not.toBe(null);
    expect(services.contentParity?.lastImport).toBe(null);
    await runConfiguredSheetMirror({ kind: 'scheduled' });
    expect(services.contentParity?.failureSince).toBe(null);
    expect(services.contentParity?.lastImport).not.toBe(null);
  });
  it('does not enable a live typed client or change the Sheet default', () => {
    vi.stubEnv('CS_DATA_MODE', 'fake'); vi.stubEnv('CS_CONTENT_STORE', 'sheet'); resetEnvCache(); resetServices();
    expect(getServices().contentImport).toBeUndefined();
    expect(getServices().repo.capability().provider).toBe('sheet');
  });
});
