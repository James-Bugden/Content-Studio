import { afterEach, expect, it, vi } from 'vitest';
import { resetEnvCache, serverEnv } from '@/lib/env';
import { getServices, resetServices } from '@/application/container';

afterEach(() => { vi.unstubAllEnvs(); resetEnvCache(); resetServices(); });
it('DB-only admission needs no backup folder or waiver; obsolete values remain validated', () => {
  for (const [key, value] of Object.entries({ CS_DATA_MODE: 'live', CS_CONTENT_STORE: 'db', CS_CONTENT_DB_ENABLED: 'true',
    CS_CONTENT_BACKUP_FOLDER_ID: '', SUPABASE_READ_MODEL_URL: 'https://synthetic.supabase.co',
    SUPABASE_READ_MODEL_SERVICE_KEY: 'synthetic-service-key-00000', SUPABASE_READ_MODEL_SOURCE_KEY: 'synthetic_source' })) vi.stubEnv(key, value);
  vi.stubEnv('CS_BACKUP_GATE_WAIVED', undefined);
  expect(serverEnv().CS_CONTENT_STORE).toBe('db');
  vi.stubEnv('CS_BACKUP_GATE_WAIVED', 'wrong'); resetEnvCache();
  expect(() => serverEnv()).toThrow('CS_BACKUP_GATE_WAIVED');
  vi.stubEnv('CS_BACKUP_GATE_WAIVED', '2026-10-25'); resetEnvCache();
  expect(serverEnv().CS_CONTENT_STORE).toBe('db'); // configuration only; SQL still requires audit
  vi.stubEnv('CS_BACKUP_GATE_WAIVED', undefined); vi.stubEnv('CS_CONTENT_BACKUP_FOLDER_ID', 'synthetic_folder'); resetEnvCache();
  expect(serverEnv().CS_CONTENT_STORE).toBe('db');
});
it('CS-066: default Sheet reads and write bytes are identical with the switch set', async () => {
  vi.stubEnv('CS_DATA_MODE', 'fake'); vi.stubEnv('VERCEL_ENV', 'preview'); vi.stubEnv('CS_CONTENT_STORE', undefined);
  vi.stubEnv('CS_CONTENT_WRITE_ENABLED', undefined);
  async function capture(waiver?: string) {
    vi.stubEnv('CS_BACKUP_GATE_WAIVED', waiver); resetEnvCache(); resetServices();
    const services = getServices(), row = await services.repo.getLibrary('SYN-L001');
    const result = await services.repo.updateLibrary({ operationId: 'synthetic-sheet-waiver', actor: { role: 'owner', sub: 'synthetic-owner' },
      target: { libraryId: 'SYN-L001' }, expectedRevision: row.revision, patch: { currentHook: 'Synthetic identical Sheet write' } });
    expect(result.ok).toBe(true); expect(serverEnv().CS_CONTENT_STORE).toBe('sheet');
    expect(services.liveCutover).toBeUndefined();
    return JSON.stringify({ rows: await services.repo.listLibrary(), writes: services.fakes!.sheet.writes });
  }
  expect(await capture('2026-10-25')).toBe(await capture());
});
