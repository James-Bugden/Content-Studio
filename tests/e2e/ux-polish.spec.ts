import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

async function checkAndCapture(page: Page, info: TestInfo, name: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true });
}

test.beforeEach(async ({ page }) => {
  expect((await page.request.post('/api/test-control', { data: { kind: 'reset' } })).status()).toBe(200);
  expect((await page.request.post('/api/test-auth', { data: { as: 'owner' } })).status()).toBe(200);
});

test('CS-059c: scheduling previews the earliest open slot before the explicit confirm', async ({ page }, info) => {
  let writes = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/schedule/promote') writes++;
  });
  await page.goto('/review?post=SYN-L005');
  const panel = page.getByRole('dialog');
  await expect(panel.getByText('These cells will be written to the Schedule. Nothing else changes.')).toBeVisible();
  const confirm = panel.getByRole('button', { name: 'Confirm and write to Thu 1 Oct \u00b7 21:00', exact: true });
  await expect(confirm).toBeVisible();
  expect(writes).toBe(0);
  await checkAndCapture(page, info, 'schedule-preview');
  await confirm.click();
  await expect(panel.getByText(/Scheduled into 2026-10-01-MAIN-LI/)).toBeVisible();
  expect(writes).toBe(1);
});

test('CS-059c: Backlog platform is one click and filtered idea groups open automatically', async ({ page }, info) => {
  await page.goto('/backlog');
  const platforms = page.getByRole('group', { name: 'Platform', exact: true });
  await platforms.getByRole('button', { name: 'LinkedIn', exact: true }).click();
  await expect(page).toHaveURL(/platform=LinkedIn/);
  await expect(platforms.getByRole('button', { name: 'LinkedIn', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await checkAndCapture(page, info, 'backlog-platform');
  await platforms.getByRole('button', { name: 'LinkedIn', exact: true }).click();
  await expect(page).not.toHaveURL(/platform=/);

  await page.goto('/backlog?view=ideas');
  const groups = page.locator('details').filter({ has: page.locator('summary').filter({ hasText: /ideas?\)/ }) });
  await expect(groups.first()).not.toHaveAttribute('open');
  await page.getByRole('group', { name: 'Platform', exact: true }).getByRole('button', { name: 'X', exact: true }).click();
  await expect(page).toHaveURL(/platform=X/);
  await expect(groups.first()).toHaveAttribute('open', '');
  for (const group of await groups.all()) await expect(group).toHaveAttribute('open', '');
  await checkAndCapture(page, info, 'backlog-ideas-filtered');
});

test('CS-059c: Posts common filters are visible, compose, and remain removable', async ({ page }, info) => {
  await page.goto('/review');
  const disclosure = page.locator('details').filter({ has: page.locator('summary').filter({ hasText: /^Filters/ }) });
  await expect(disclosure).not.toHaveAttribute('open');
  const platform = page.getByRole('group', { name: 'Target platform', exact: true });
  const review = page.getByRole('group', { name: 'Review status', exact: true });
  await platform.getByRole('button', { name: 'LinkedIn', exact: true }).click();
  await review.getByRole('button', { name: 'Not reviewed', exact: true }).click();
  await expect(page).toHaveURL(/target=LinkedIn/);
  await expect(page).toHaveURL(/review=Pending/);
  await expect(disclosure).not.toHaveAttribute('open');
  await checkAndCapture(page, info, 'posts-filters');
  await review.getByRole('button', { name: 'Not reviewed', exact: true }).click();
  await expect(page).not.toHaveURL(/review=Pending/);
  await expect(page).toHaveURL(/target=LinkedIn/);
});

test('CS-059c: Fix issues keeps health folded and the existing full-page fix action', async ({ page }, info) => {
  await page.goto('/reconcile');
  await expect(page.getByRole('heading', { name: 'Adapter health (this server instance)' })).toBeHidden();
  const diagnostics = page.locator('details').filter({ has: page.locator('summary').filter({ hasText: /^Diagnostics$/ }) });
  await expect(diagnostics).not.toHaveAttribute('open');
  await checkAndCapture(page, info, 'fix-issues');
  const stale = page.getByRole('article').filter({ hasText: 'SYN-L006: approval no longer matches' });
  await expect(stale.getByRole('link', { name: /Review/ })).toHaveAttribute('href', '/review/SYN-L006');
});
