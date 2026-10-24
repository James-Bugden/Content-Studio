import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { STATE_KINDS } from '../../src/components/state-view';

test.beforeEach(async ({ page }) => {
  expect((await page.request.post('/api/test-control', { data: { kind: 'reset' } })).ok()).toBe(true);
  expect((await page.request.post('/api/test-auth', { data: { as: 'owner' } })).ok()).toBe(true);
});

test('shared states, route loading, AI errors and stale metadata are accessible', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/dev/states');
  for (const kind of STATE_KINDS) {
    const state = page.getByRole('region', { name: 'Region states', exact: true }).locator(`[data-state="${kind}"]`).first();
    await expect(state).toBeVisible();
    await expect(state).toHaveAttribute('role', kind === 'loading' || kind === 'empty' || kind === 'no_match' ? 'status' : 'alert');
  }
  await expect(page.getByRole('region', { name: 'Route loading', exact: true }).locator('[data-state="loading"]')).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByRole('region', { name: 'AI errors', exact: true }).locator('[data-state]')).toHaveCount(14);
  await expect(page.getByText(/as of 12:30 Taipei/)).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `artifacts/states-gallery-${page.viewportSize()!.width}.png`, fullPage: true });
  await page.getByRole('region', { name: 'Region states', exact: true }).screenshot({ path: `artifacts/states-patterns-${page.viewportSize()!.width}.png` });
  expect(errors).toEqual([]);
});

test('Backlog distinguishes search loading, error, retry and no match', async ({ page }) => {
  await page.goto('/backlog');
  const input = page.getByRole('searchbox', { name: 'Find a post' });
  await page.route('**/api/backlog/search', async (route) => {
    await route.fulfill({ status: 503, json: { ok: false, code: 'PROVIDER_UNAVAILABLE' } });
  });
  await input.fill('synthetic-no-such-post');
  await expect(page.locator('[data-state="loading"]')).toBeVisible();
  await expect(page.locator('[data-state="provider_error"]')).toContainText('Your search text is kept here.');
  await expect(input).toHaveValue('synthetic-no-such-post');
  await expect(page.locator('[data-backlog-id]:visible')).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.unroute('**/api/backlog/search');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.locator('[data-state="no_match"]')).toBeVisible();
  await expect(page.locator('[data-backlog-id]:visible')).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await input.fill('');
  await expect(page.locator('[data-backlog-id]:visible').first()).toBeVisible();
});

for (const path of ['/backlog?source=synthetic-no-such-source', '/backlog?view=ideas&source=synthetic-no-such-source', '/review?target=Threads&review=Skipped', '/published?platform=LinkedIn']) {
  test(`${path}: empty filtered results use a shared state`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator('[data-state="no_match"], [data-state="empty"]').first()).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
}

for (const [path, tab] of [
  ['/backlog?view=ideas', 'Content Queue'], ['/review', 'Content Library'], ['/ready', 'Ready Queue'],
  ['/schedule', 'Content Schedule'], ['/published', 'Content Schedule'], ['/visuals', 'Content Library'],
] as const) {
  test(`${path}: a failed read is an error, never an empty list`, async ({ page }) => {
    expect((await page.request.post('/api/test-control', { data: { kind: 'fail', provider: 'sheet', op: 'read', tab, code: 'PROVIDER_UNAVAILABLE' } })).ok()).toBe(true);
    await page.goto(path);
    await expect(page.locator('[data-state="provider_error"]')).toBeVisible();
    await expect(page.locator('[data-state="empty"], [data-state="no_match"]')).toHaveCount(0);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
}

test('Fix issues keeps unreadable sources distinct from everything agreeing', async ({ page }) => {
  expect((await page.request.post('/api/test-control', { data: { kind: 'fail', provider: 'sheet', op: 'read', tab: 'Content Library', code: 'PROVIDER_UNAVAILABLE', times: 2 } })).ok()).toBe(true);
  await page.goto('/reconcile');
  await expect(page.locator('[data-state="provider_error"]')).toContainText('Some sources could not be read');
  await expect(page.getByText('Everything agrees', { exact: true })).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

for (const [path, request] of [
  ['/backlog?post=SYN-L001', '**/api/library/SYN-L001/editor'],
  ['/review?post=SYN-L001', '**/api/panel/post/SYN-L001'],
  ['/backlog?view=ideas&queue=SYN-L001', '**/api/backlog/SYN-L001'],
  ['/schedule?slot=2026-10-01-MAIN-LI', '**/api/panel/slot/2026-10-01-MAIN-LI'],
] as const) {
  test(`${path}: a network failure leaves editor loading for the shared error`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route(request, (route) => route.abort('failed'));
    await page.goto(path);
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('[data-state="provider_error"]')).toBeVisible();
    await expect(dialog.locator('[data-state="loading"]')).toHaveCount(0);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(errors).toEqual([]);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).toHaveCount(0);
  });
}
