import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GET as exportGET } from '@/app/api/ops/content-export/reconcile/route';
import { GET as backupGET } from '@/app/api/ops/content-backup/reconcile/route';
import { getServices, resetServices } from '@/application/container';
import { resetEnvCache } from '@/lib/env';

beforeEach(() => { vi.stubEnv('CS_DATA_MODE', 'fake'); vi.stubEnv('CS_CONTENT_STORE', 'db'); vi.stubEnv('VERCEL_ENV', 'preview'); vi.stubEnv('CRON_SECRET', 'synthetic-cron-secret-12345678901234567890'); resetEnvCache(); resetServices(); });
afterEach(() => { vi.unstubAllEnvs(); resetEnvCache(); resetServices(); });
it.each([exportGET, backupGET])('authenticates before any maintenance writes; rejects missing/bad cron bearer', async handler => {
  const services = getServices(), before = services.fakes!.sheet.writes.length;
  for (const authorization of ['', 'Bearer wrong']) {
    const response = await handler(new Request('http://localhost/api/ops/synthetic', { headers: { authorization } }));
    expect(response.status).toBe(403);
  }
  expect(services.fakes!.sheet.writes).toHaveLength(before);
  expect(services.contentBackup!.journal.lastVerified).toBeNull();
  expect((await handler(new Request('http://localhost/api/ops/synthetic', { headers: { authorization: 'Bearer synthetic-cron-secret-12345678901234567890' } }))).status).toBe(200);
});
it('never exposes private backup file IDs or row payloads in cron responses', async () => {
  const response = await backupGET(new Request('http://localhost/api/ops/synthetic', { headers: { authorization: 'Bearer synthetic-cron-secret-12345678901234567890' } }));
  const text = await response.text();
  expect(response.status).toBe(200); expect(text).not.toContain('synthetic-backup-'); expect(text).not.toContain('draft_content'); expect(text).toContain('manifestHash');
});
it.each([exportGET, backupGET])('cannot schedule exports/backups while Sheet is authoritative', async handler => {
  vi.stubEnv('CS_CONTENT_STORE', 'sheet'); resetEnvCache(); resetServices();
  expect((await handler(new Request('http://localhost/api/ops/synthetic', { headers: { authorization: 'Bearer synthetic-cron-secret-12345678901234567890' } }))).status).toBe(403);
});
