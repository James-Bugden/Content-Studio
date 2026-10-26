import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/navigation-counts', route => route.fulfill({ json: {
    nextUp: 1100, fixIssues: 2, expiresAt: Date.now() + 15000,
  } }));
});

for (const width of [1280, 375, 800, 801]) {
  test(`CS-073 foundation: responsive navigation, counts and shared status slot at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/dev/states');
    const nav = page.getByRole('navigation', { name: 'Primary' });
    const phone = width <= 800;
    await expect(nav.locator('[data-nav-count="/"]')).toHaveText('999+');
    const visibleLinks = nav.getByRole('link');
    expect(await visibleLinks.allTextContents()).toEqual(phone
      ? ['Next up999+', 'Posts', 'Calendar', 'Backlog']
      : ['Next up999+', 'Posts', 'Calendar', 'Backlog', 'Published', 'Fix issues2', 'Replies']);
    await expect(page.getByRole('button', { name: 'Collapse navigation' })).toBeVisible({ visible: !phone });
    await expect(nav.locator('summary')).toBeVisible({ visible: phone });
    expect(await nav.evaluate(el => getComputedStyle(el).position)).toBe(phone ? 'fixed' : 'static');
    if (phone) {
      for (const link of await visibleLinks.all()) {
        const box = await link.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.width).toBeGreaterThanOrEqual(44);
      }
      await nav.getByText('More', { exact: true }).click();
      await expect(nav.getByRole('link', { name: /^Fix issues/ })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(nav.getByRole('link', { name: /^Fix issues/ })).toBeHidden();
    } else {
      const before = (await nav.boundingBox())!.width;
      await page.getByRole('button', { name: 'Collapse navigation' }).click();
      expect((await nav.boundingBox())!.width).toBeLessThan(before);
      await expect(nav.getByRole('link', { name: 'Posts' })).toBeVisible();
      await page.getByRole('button', { name: 'Expand navigation' }).click();
    }
    const status = page.getByTestId('shell-status');
    await expect(status.getByRole('region', { name: 'Integration status' })).toContainText('Google Drive read-only');
    await expect(status).toContainText('Editing and saving are disabled until a fresh read succeeds.');
    await expect(page.getByRole('main').getByRole('region', { name: 'Integration status' })).toHaveCount(0);
    expect(await status.evaluate(el => el.previousElementSibling?.tagName)).toBe('HEADER');
    await expect(page.getByRole('searchbox', { name: 'Search studio' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New post' })).toBeVisible();
    await expect(page.getByLabel('Account menu')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('CS-073 collapsed desktop rail restores labelled phone tabs after resizing', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/dev/states');
  await page.getByRole('button', { name: 'Collapse navigation' }).click();
  await page.setViewportSize({ width: 375, height: 812 });
  const label = page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Posts' }).locator('.studio-nav-label');
  expect(await label.evaluate(el => ({ position: getComputedStyle(el).position, clip: getComputedStyle(el).clipPath }))).toEqual({ position: 'static', clip: 'none' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
