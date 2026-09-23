import { expect, test } from '@playwright/test';

test('health reports commit and capabilities only, never cached', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.ok()).toBe(true);
  expect(res.headers()['cache-control']).toContain('no-store');
  const body = (await res.json()) as { ok: boolean; mode: string; capabilities: { provider: string; state: string }[] };
  expect(body.ok).toBe(true);
  expect(body.mode).toBe('fake');
  expect(body.capabilities.map((c) => c.provider).sort()).toEqual(['ai', 'auth', 'drive', 'sheet', 'typefully']);
});

test('security headers are present on pages', async ({ request }) => {
  const res = await request.get('/');
  const h = res.headers();
  expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['x-frame-options']).toBe('DENY');
});
