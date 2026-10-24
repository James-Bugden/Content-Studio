import { expect, test } from '@playwright/test';

test('health reports commit and capabilities only, never cached', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.ok()).toBe(true);
  expect(res.headers()['cache-control']).toContain('no-store');
  const body = (await res.json()) as { ok: boolean; commit: string; mode: string; capabilities: { provider: string; state: string; mode: string }[] };
  expect(Object.keys(body).sort()).toEqual(['capabilities', 'commit', 'mode', 'ok']);
  expect(body.commit).toEqual(expect.any(String));
  expect(body.commit.length).toBeGreaterThan(0);
  expect(body.ok).toBe(true);
  expect(body.mode).toBe('fake');
  expect(body.capabilities.map((c) => c.provider).sort()).toEqual(['ai', 'auth', ...(process.env.CS_E2E_CONTENT_STORE === 'db-read' || process.env.CS_E2E_CONTENT_STORE === 'db' ? ['db'] : []), 'drive', 'sheet', 'typefully']);
  for (const capability of body.capabilities) {
    expect(Object.keys(capability).sort()).toEqual(['mode', 'provider', 'state']);
    expect(capability.state).toBe('ready');
    expect(capability.mode).toBe('fake');
  }
});

test('security headers are present on pages', async ({ request }) => {
  const res = await request.get('/');
  const h = res.headers();
  expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['x-frame-options']).toBe('DENY');
});
