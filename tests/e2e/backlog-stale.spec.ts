import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  expect((await page.request.post('/api/test-control', { data: { kind: 'reset' } })).ok()).toBe(true);
  expect((await page.request.post('/api/test-auth', { data: { as: 'owner' } })).ok()).toBe(true);
});

for (const code of ['RATE_LIMITED', 'PROVIDER_UNAVAILABLE']) {
  test(`${code}: last good Backlog is labelled, editing blocked, Retry restores editing`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/backlog');
    const rows = page.locator('[data-backlog-id]:visible');
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
    await page.request.post('/api/test-control', { data: { kind: 'fail', provider: 'sheet', op: 'read', tab: 'Content Library', code } });
    await page.goto('/backlog?post=SYN-L001');
    await expect(page.getByRole('status').filter({ hasText: 'may be out of date' })).toBeVisible();
    await expect(rows).toHaveCount(count);
    await expect(page.getByRole('button', { name: 'Edit post' }).first()).toBeDisabled();
    await expect(page.getByRole('link', { name: /^Edit / })).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: /PESTO stage/ })).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    for (const width of [375, 500, 750, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.getByRole('link', { name: 'Retry', exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      if (code === 'RATE_LIMITED') await page.screenshot({ path: `artifacts/stale-backlog-${width}.png`, fullPage: true });
    }
    await page.evaluate(() => { document.body.style.zoom = '2'; });
    await expect(page.getByRole('link', { name: 'Retry', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (code === 'RATE_LIMITED') await page.screenshot({ path: 'artifacts/stale-backlog-zoom.png', fullPage: true });
    await page.evaluate(() => { document.body.style.zoom = ''; });
    expect(errors).toEqual([]);
    await page.getByRole('link', { name: 'Retry', exact: true }).click();
    await expect(page.getByText(/Showing the last good read/)).toHaveCount(0);
    await expect(page.getByRole('link', { name: /^Edit / }).first()).toBeVisible();
  });
}

test('cold start failure keeps the error screen', async ({ page }) => {
  await page.request.post('/api/test-control', { data: { kind: 'fail', provider: 'sheet', op: 'read', tab: 'Content Library', code: 'RATE_LIMITED' } });
  await page.goto('/backlog');
  await expect(page.getByRole('link', { name: 'Try again', exact: true })).toBeVisible();
  await expect(page.locator('[data-backlog-id]:visible')).toHaveCount(0);
  await expect(page.getByText(/Showing the last good read/)).toHaveCount(0);
});
