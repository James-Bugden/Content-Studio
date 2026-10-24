import { afterEach, describe, expect, it, vi } from 'vitest';
import { getServices, resetServices } from '@/application/container';
import { resetEnvCache } from '@/lib/env';
import { runConfiguredSheetMirror } from '@/lib/sheet-mirror-operation';
import { requireCronSecret } from '@/lib/cron-auth';

afterEach(() => { vi.unstubAllEnvs(); resetServices(); resetEnvCache(); });
describe('typed import scheduling seam', () => {
  it('reuses the complete-snapshot operation in fake shadow mode and records safe run evidence', async () => {
    vi.stubEnv('CS_DATA_MODE', 'fake'); vi.stubEnv('CS_CONTENT_STORE', 'db-shadow'); resetEnvCache(); resetServices();
    const services = getServices();
    const result = await runConfiguredSheetMirror();
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
    await expect(runConfiguredSheetMirror()).rejects.toThrow('Synthetic failure');
    expect(services.contentParity?.failureSince).not.toBe(null);
    expect(services.contentParity?.lastImport).toBe(null);
    await runConfiguredSheetMirror();
    expect(services.contentParity?.failureSince).toBe(null);
    expect(services.contentParity?.lastImport).not.toBe(null);
  });
  it('does not enable a live typed client or change the Sheet default', () => {
    vi.stubEnv('CS_DATA_MODE', 'fake'); vi.stubEnv('CS_CONTENT_STORE', 'sheet'); resetEnvCache(); resetServices();
    expect(getServices().contentImport).toBeUndefined();
    expect(getServices().repo.capability().provider).toBe('sheet');
  });
});
