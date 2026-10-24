import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

async function checkAndCapture(page: Page, info: TestInfo, name: string) {
  // Next streams the document title with the page: scan only the settled document.
  await expect.poll(() => page.title(), { message: 'document title is set before the axe scan' }).not.toBe('');
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
  let previewReads = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/schedule/promote') writes++;
    if (new URL(request.url()).pathname === '/api/schedule/promote/preview') previewReads++;
  });
  await page.goto('/review?post=SYN-L005');
  const panel = page.getByRole('dialog');
  await expect(panel.getByText('These cells will be written to the Schedule. Nothing else changes.')).toBeVisible();
  const confirm = panel.getByRole('button', { name: 'Confirm and write to Thu 1 Oct \u00b7 21:00', exact: true });
  await expect(confirm).toBeVisible();
  expect(writes).toBe(0);
  expect(previewReads).toBe(0);
  await checkAndCapture(page, info, 'schedule-preview');
  await confirm.click();
  await expect(panel.getByText(/Scheduled into 2026-10-01-MAIN-LI/)).toBeVisible();
  expect(writes).toBe(1);
});

test('CS-059c: at 21:30 Taipei a blank-time elapsed slot is absent, and exhausted slots show the no-slot state', async ({ page }, info) => {
  expect((await page.request.post('/api/test-control', { data: { kind: 'clock', today: '2026-10-01', time: '21:30' } })).status()).toBe(200);
  expect((await page.request.post('/api/test-control', { data: { kind: 'schedule_edit', contentId: '2026-10-01-MAIN-LI', header: 'Publish Time (Taipei)', value: '' } })).status()).toBe(200);
  await page.goto('/review?post=SYN-L005');
  const panel = page.getByRole('dialog');
  await expect(panel.getByRole('button', { name: 'Confirm and write to Sat 3 Oct · 21:00', exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: /Thu 1 Oct/ })).toHaveCount(0);
  await checkAndCapture(page, info, 'past-slot');
  expect((await page.request.post('/api/test-control', { data: { kind: 'clock', today: '2026-10-03', time: '21:30' } })).status()).toBe(200);
  await page.reload();
  await expect(panel.getByText('No open LinkedIn slots in the next three weeks.')).toBeVisible();
  await expect(panel.getByRole('button', { name: /Confirm and write/ })).toHaveCount(0);
  await page.goto('/ready/SYN-L005/promote?slot=2026-10-01-MAIN-LI');
  await expect(page.getByText('No available slot rows in the next three weeks. Add slot rows in the Sheet first.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Confirm and write/ })).toHaveCount(0);
});

test('CS-059c: a full-page slot outside the options falls back with an explanation', async ({ page }, info) => {
  await page.goto('/ready/SYN-L005/promote?slot=2026-12-01-MAIN-LI');
  await expect(page.getByText('This slot cannot be used. Choose another slot.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm and write to Thu 1 Oct · 21:00', exact: true })).toBeVisible();
  await checkAndCapture(page, info, 'promote-fallback');
});

test('CS-059c: failed automatic preview falls back without moving the tabs', async ({ page }, info) => {
  // Exercise the compatibility fallback when the initial snapshot has no preview.
  await page.route('**/api/panel/post/SYN-L005', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.data.initialPreview = null;
    await route.fulfill({ response, json: body });
  });
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/schedule/promote/preview?**', async (route) => {
    if (new URL(route.request().url()).searchParams.get('contentId') === '2026-10-01-MAIN-LI') {
      await pending;
      await route.fulfill({ json: { ok: false, problems: ['This slot cannot be used.'] } });
    } else await route.continue();
  });
  await page.goto('/review?post=SYN-L005');
  const panel = page.getByRole('dialog');
  const tabs = panel.getByRole('tablist');
  try {
    await expect(panel.getByText('Loading the preview')).toBeVisible();
    const before = await tabs.boundingBox();
    release();
    await expect(panel.getByRole('button', { name: 'Confirm and write to Sat 3 Oct · 21:00', exact: true })).toBeVisible();
    const after = await tabs.boundingBox();
    expect(after?.y).toBe(before?.y);
    await expect(panel.getByRole('button', { name: 'Thu 1 Oct · 21:00', exact: true })).toBeEnabled();
    await checkAndCapture(page, info, 'preview-fallback');
  } finally { release(); }
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
  const groups = page.locator('details').filter({ has: page.locator('summary').filter({ hasText: /\(\d+ ideas?\)/ }) });
  // The synthetic Queue has two source groups, both targeting LinkedIn.
  // Assert the inventory so an empty collection cannot pass the open checks.
  await expect(groups).toHaveCount(2);
  await expect(groups.first()).not.toHaveAttribute('open');
  await page.getByRole('group', { name: 'Platform', exact: true }).getByRole('button', { name: 'LinkedIn', exact: true }).click();
  await expect(page).toHaveURL(/platform=LinkedIn/);
  await expect(groups).toHaveCount(2);
  await expect(groups.first()).toHaveAttribute('open', '');
  for (const group of await groups.all()) await expect(group).toHaveAttribute('open', '');
  await checkAndCapture(page, info, 'backlog-ideas-filtered');
});

test('CS-059c: Posts common filters are visible, compose, and remain removable', async ({ page }, info) => {
  await page.goto('/review');
  // The summary includes a decorative arrow before its visible label.
  const disclosure = page.locator('details').filter({ has: page.locator('summary').filter({ hasText: /Filters/ }) });
  await expect(disclosure).not.toHaveAttribute('open');
  const platform = page.getByRole('group', { name: 'Target platform', exact: true });
  const review = page.getByRole('group', { name: 'Review status', exact: true });
  // Keep the first RSC navigation in flight: the second click must compose
  // with the pending selection, rather than with the previous committed URL.
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/review?**', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().headers().rsc === '1' && url.searchParams.get('target') === 'LinkedIn' && !url.searchParams.has('review')) await pending;
    await route.continue();
  });
  try {
    const firstNavigation = page.waitForRequest((request) => new URL(request.url()).searchParams.get('target') === 'LinkedIn');
    await platform.getByRole('button', { name: 'LinkedIn', exact: true }).click();
    await firstNavigation;
    await expect(platform.getByRole('button', { name: 'LinkedIn', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await review.getByRole('button', { name: 'Not reviewed', exact: true }).click();
  } finally { release(); }
  await expect(page).toHaveURL(/target=LinkedIn/);
  await expect(page).toHaveURL(/review=Pending/);
  await expect(disclosure.locator('summary')).toContainText('(2 on)');
  await expect(page.getByRole('button', { name: 'Clear filters', exact: true })).toHaveCount(1);
  await expect(disclosure).not.toHaveAttribute('open');
  // Axe runs against the settled document: wait for the committed navigation's title and results.
  await expect(page).toHaveTitle('Posts | Content Studio');
  await expect(page.getByText(/Showing 1 to \d+ of \d+/).first()).toBeVisible();
  await checkAndCapture(page, info, 'posts-filters');
  await review.getByRole('button', { name: 'Not reviewed', exact: true }).click();
  await expect(page).not.toHaveURL(/review=Pending/);
  await expect(page).toHaveURL(/target=LinkedIn/);
  await disclosure.locator('summary').click();
  await page.getByLabel('Source platform', { exact: true }).selectOption('LinkedIn');
  await expect(disclosure.locator('summary')).toContainText('(2 on)');
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(page).not.toHaveURL(/target=|from=|review=/);
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


test('CS-059g: Posts announces results once and clears lane with every filter', async ({ page }) => {
  await page.goto('/review?lane=review&target=Threads');
  await expect(page).toHaveTitle('Posts | Content Studio');
  const announcement = page.locator('[aria-live="polite"]').filter({ hasText: /None of the .* Library rows match these filters/ });
  await expect(announcement).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Clear filters', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Clear all filters', exact: true }).click();
  await expect(page).toHaveURL(/\/review$/);
  await expect(page.getByRole('navigation', { name: 'Post tabs' }).getByRole('link', { name: /^All/ })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('[aria-live="polite"]').filter({ hasText: /Showing 1 to/ })).toHaveCount(1);
  await page.goto('/review?lane=review&target=LinkedIn');
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(page).toHaveURL(/\/review$/);
});
