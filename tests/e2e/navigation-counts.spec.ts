import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  expect((await page.request.post('/api/test-control', { data: { kind: 'reset' } })).status()).toBe(200);
  expect((await page.request.post('/api/test-auth', { data: { as: 'owner' } })).status()).toBe(200);
});

test('CS-044: cached Next up and blocking Fix issues badges in desktop and phone navigation', async ({ page }, testInfo) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Primary' });
  const urgent = await page.getByRole('heading', { name: /Do these now/ }).innerText();
  const count = urgent.match(/\((\d+)\)/)![1]!;
  await expect(nav.locator('[data-nav-count="/"]')).toHaveText(count);
  await expect(nav.locator('[data-nav-count="/"]')).toBeInViewport();

  await page.goto('/reconcile');
  const phone = (page.viewportSize()?.width ?? 1280) < 768;
  if (phone) await nav.getByText('More', { exact: true }).click();
  const fixBadge = nav.locator('[data-nav-count="/reconcile"]:visible');
  await expect(fixBadge).toHaveText('2'); // two blocking groups; attention items are excluded
  await expect(fixBadge).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('navigation.png') });
  const violations = (await new AxeBuilder({ page }).include('nav[aria-label="Primary"]').analyze()).violations;
  expect(violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

  // A page that does not load either model can reuse an existing count.
  await page.goto('/dev/states');
  if (phone) await nav.getByText('More', { exact: true }).click();
  await expect(nav.locator('[data-nav-count="/reconcile"]:visible')).toHaveText('2');
});

test('CS-044: unavailable/cold count renders no number and no nav error', async ({ page }) => {
  await page.goto('/dev/states');
  await expect(page.getByRole('navigation', { name: 'Primary' }).locator('[data-nav-count]')).toHaveCount(0);
  await page.route('**/api/navigation-counts', (route) => route.fulfill({ status: 503, body: '{}' }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Next up', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Primary' }).locator('[data-nav-count]')).toHaveCount(0);
});

test('CS-044: 1,100 items display as 999+ and fit the phone tab bar', async ({ page }, testInfo) => {
  await page.route('**/api/navigation-counts', (route) => route.fulfill({
    json: { nextUp: 1100, fixIssues: 1100, expiresAt: Date.now() + 15_000 },
  }));
  await page.goto('/dev/states');
  const nav = page.getByRole('navigation', { name: 'Primary' });
  const badge = nav.locator('[data-nav-count="/"]');
  await expect(badge).toHaveText('999+');
  await expect(badge).toBeInViewport();
  // Check the badge fits its own tab, as well as the overall viewport.
  expect(await badge.evaluate((element) => {
    const badgeRect = element.getBoundingClientRect();
    const tabRect = element.closest('li')!.getBoundingClientRect();
    return badgeRect.left >= tabRect.left && badgeRect.right <= tabRect.right;
  })).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('navigation-999-plus.png') });
  if ((page.viewportSize()?.width ?? 1280) < 768) await nav.getByText('More', { exact: true }).click();
  await expect(nav.locator('[data-nav-count="/reconcile"]:visible')).toHaveText('999+');
});
