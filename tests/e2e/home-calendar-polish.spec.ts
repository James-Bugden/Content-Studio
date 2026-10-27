import { expect, test } from '@playwright/test';

// Synthetic-only screenshots and responsive interaction checks for stage 2.
test.beforeEach(async ({ page }) => {
  expect((await page.request.post('/api/test-control', { data: { kind: 'reset' } })).ok()).toBe(true);
  expect((await page.request.post('/api/test-auth', { data: { as: 'owner' } })).ok()).toBe(true);
});

test('Next up groups every visible action with platform marks and phone-sized controls', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const urgent = page.getByRole('region', { name: /Do these now/ });
  await expect(urgent.locator('[data-action-group="Chinese adaptation"]')).toContainText('Update Chinese');
  await expect(urgent.locator('[data-action-group="Review & fix"]')).toContainText('Decide duplicate');
  const tasks = page.locator('[data-task]');
  const keys = await tasks.evaluateAll(rows => rows.map(row => row.getAttribute('data-task')));
  expect(new Set(keys).size).toBe(keys.length);
  for (const row of await tasks.all()) {
    await expect(row.locator('svg').first()).toBeVisible();
    const link = row.getByRole('link');
    expect((await link.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  }
  await expect(page.getByRole('region', { name: 'Coming up' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('next-up.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('Calendar week adapts to the viewport and keeps list, period and slot navigation', async ({ page }, info) => {
  await page.goto('/schedule');
  const phone = (page.viewportSize()?.width ?? 0) < 1024;
  if (phone) {
    await expect(page.getByTestId('day-list')).toBeVisible();
    await expect(page.getByTestId('week-grid')).toBeHidden();
  } else {
    await expect(page.getByTestId('week-grid')).toBeVisible();
    await expect(page.getByTestId('day-list')).toBeHidden();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('calendar-week.png'), fullPage: true });
  const nextWeek = page.getByRole('link', { name: 'Next week', exact: true });
  expect((await nextWeek.boundingBox())?.width).toBeGreaterThanOrEqual(44);
  await page.getByRole('link', { name: 'Next week', exact: true }).click();
  await expect(page).toHaveURL(/week=2026-10-05/);
  await page.getByRole('link', { name: 'Previous week', exact: true }).click();
  await expect(page).toHaveURL(/week=2026-09-28/);
  await page.getByRole('link', { name: 'List', exact: true }).click();
  await expect(page).toHaveURL(/view=list/);
  await expect(page.getByTestId('day-list')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('link', { name: 'List', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.locator('[data-content-id="2026-10-01-MAIN-X"]').getByRole('link').click();
  await expect(page.getByRole('dialog')).toBeVisible();
});
