import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * CS-005 journeys in fake + e2e mode with synthetic identities (SEC-05, SEC-07, SEC-09).
 * The app runs with the e2e-only AUTH_SECRET from playwright.config.ts; it must never
 * reach the browser.
 */
const E2E_AUTH_SECRET = 'e2e-only-auth-secret-not-a-real-value-000000';

async function signInAs(request: APIRequestContext, as: 'owner' | 'viewer' | 'stranger' | 'none') {
  const res = await request.post('/api/test-auth', { data: { as } });
  expect(res.status()).toBe(200);
}

async function me(page: Page) {
  const res = await page.request.get('/api/me');
  return { status: res.status(), headers: res.headers(), body: (await res.json()) as Record<string, unknown> };
}

test('anonymous page request redirects to /login', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Sign in to Content Studio' })).toBeVisible();
});

test('anonymous /api/me is 401 JSON, never cached', async ({ request }) => {
  const res = await request.get('/api/me', { maxRedirects: 0 });
  expect(res.status()).toBe(401);
  expect(res.headers()['content-type']).toContain('application/json');
  expect(res.headers()['cache-control']).toContain('no-store');
  expect(((await res.json()) as { code: string }).code).toBe('AUTH_REQUIRED');
});

test('the JSON session endpoint is not offered', async ({ request }) => {
  const res = await request.get('/api/auth/session');
  expect(res.status()).toBe(404);
});

test('stranger is forbidden and cannot open the home page', async ({ page }) => {
  await signInAs(page.request, 'stranger');
  const r = await me(page);
  expect(r.status).toBe(403);
  expect(r.body.code).toBe('FORBIDDEN');
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
});

test('viewer and owner see their role and nothing else', async ({ page }) => {
  await signInAs(page.request, 'viewer');
  let r = await me(page);
  expect(r.status).toBe(200);
  expect(r.body).toEqual({ ok: true, role: 'viewer' });

  await signInAs(page.request, 'owner');
  r = await me(page);
  expect(r.status).toBe(200);
  expect(r.body).toEqual({ ok: true, role: 'owner' });
  expect(r.headers['cache-control']).toContain('no-store');
});

test('SEC-07: session cookie is httpOnly and the secret never reaches the browser', async ({ page }) => {
  await signInAs(page.request, 'owner');
  const scripts: string[] = [];
  page.on('response', async (res) => {
    if (res.request().resourceType() === 'script') scripts.push(await res.text().catch(() => ''));
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Review queue' })).toBeVisible();

  const cookies = await page.context().cookies();
  const session = cookies.find((c) => c.name === 'cs-test-auth');
  expect(session?.httpOnly).toBe(true);
  expect(session?.sameSite).toBe('Lax');
  expect(await page.evaluate(() => document.cookie)).not.toContain('cs-test-auth');

  await page.waitForLoadState('networkidle');
  const html = await page.content();
  expect(html).not.toContain(E2E_AUTH_SECRET);
  expect(scripts.length).toBeGreaterThan(0);
  for (const js of scripts) expect(js).not.toContain(E2E_AUTH_SECRET);
});

test('SEC-09: sign out clears cs: tab-local recovery and returns to /login', async ({ page }) => {
  await signInAs(page.request, 'owner');
  await page.goto('/');
  await page.evaluate(() => {
    sessionStorage.setItem('cs:draft:SYNTH-001', 'synthetic unsaved text');
    sessionStorage.setItem('cs:recovery', '{}');
    sessionStorage.setItem('unrelated', 'kept');
  });
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login\?signed_out=1$/);
  await expect(page.getByRole('status')).toContainText('You are signed out');

  const left = await page.evaluate(() => Object.keys(sessionStorage));
  expect(left.filter((k) => k.startsWith('cs:'))).toEqual([]);
  expect(left).toContain('unrelated');

  const r = await me(page);
  expect(r.status).toBe(401);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
});
