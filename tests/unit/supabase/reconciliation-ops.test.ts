import { describe, expect, it } from 'vitest';
import { AppError } from '@/domain/errors';
import { requireCronSecret } from '@/lib/cron-auth';
import { resetEnvCache } from '@/lib/env';
import { GET } from '@/app/api/ops/sheet-mirror/reconcile/route';

describe('MIG-04: reconciliation operation boundary', () => {
  it('fails closed when the cron secret or bearer header is absent or wrong', () => {
    const request = (authorization?: string) =>
      new Request('https://studio.example/api/ops/sheet-mirror/reconcile', { headers: authorization ? { authorization } : {} });
    for (const run of [
      () => requireCronSecret(request(), undefined),
      () => requireCronSecret(request(), '0123456789abcdef'),
      () => requireCronSecret(request('Bearer wrong-secret'), '0123456789abcdef'),
    ]) {
      expect(run).toThrowError(AppError);
      try {
        run();
      } catch (error) {
        expect(error).toMatchObject({ code: 'FORBIDDEN', details: { reason: 'cron_auth' } });
      }
    }
  });

  it('accepts only the exact bearer value', () => {
    const secret = '0123456789abcdef';
    const request = new Request('https://studio.example/api/ops/sheet-mirror/reconcile', { headers: { authorization: `Bearer ${secret}` } });
    expect(() => requireCronSecret(request, secret)).not.toThrow();
  });

  it('the scheduler route authenticates before checking mirror configuration', async () => {
    const before = process.env.CRON_SECRET;
    try {
      delete process.env.CRON_SECRET;
      resetEnvCache();
      const denied = await GET(new Request('https://studio.example/api/ops/sheet-mirror/reconcile'));
      expect(denied.status).toBe(403);
      expect(await denied.json()).toMatchObject({ ok: false, code: 'FORBIDDEN' });

      process.env.CRON_SECRET = '0123456789abcdef';
      resetEnvCache();
      const disabled = await GET(
        new Request('https://studio.example/api/ops/sheet-mirror/reconcile', { headers: { authorization: 'Bearer 0123456789abcdef' } }),
      );
      expect(disabled.status).toBe(503);
      expect(await disabled.json()).toMatchObject({ ok: false, code: 'CONFIG_MISSING' });
    } finally {
      if (before === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = before;
      resetEnvCache();
    }
  });
});
