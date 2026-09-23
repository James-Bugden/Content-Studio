import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * Calendar redesign (UX): week grid, month grid, list view and the "Needs you this
 * week" strip. The e2e server pins Taipei today to 2026-09-30 (CS_FAKE_TODAY);
 * synthetic slots exist for 2026-10-01 to 2026-10-03. Each describe block sets its
 * own viewport, so the journey runs the same way in both projects.
 */
test.beforeEach(async ({ page }) => {
  expect((await page.request.post('/api/test-control', { data: { kind: 'reset' } })).status()).toBe(200);
  expect((await page.request.post('/api/test-auth', { data: { as: 'owner' } })).status()).toBe(200);
});

const visibleCard = (page: Page, contentId: string) => page.locator(`[data-content-id="${contentId}"]`).filter({ visible: true });

async function expectNoSeriousAxe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`)).toEqual([]);
}

async function expectNoHorizontalOverflow(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(scroll).toBeLessThanOrEqual(client);
}

test.describe('desktop, 1280 px', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('UX-07: week view has one row per platform and marks today in words', async ({ page }) => {
    await page.goto('/schedule');
    const grid = page.getByTestId('week-grid');
    await expect(grid).toBeVisible();
    for (const platform of ['X', 'Threads', 'LinkedIn']) {
      await expect(grid.locator(`[data-platform-row="${platform}"]`)).toHaveText(platform);
    }
    const todayHeader = grid.locator('[data-day-header="2026-09-30"]');
    await expect(todayHeader).toContainText('Wed');
    await expect(todayHeader).toContainText('Today');
    await expect(grid.locator('[data-day-header="2026-10-01"]')).not.toContainText('Today');
    await expect(page.getByTestId('day-list')).toBeHidden();
    // Technical Content IDs stay out of the visible text.
    await expect(grid).not.toContainText('2026-10-01-MAIN-X');
    const xDay = page.getByRole('group', { name: 'X, Thursday 1 October' });
    await expect(xDay).toContainText('Your first offer is a draft.');
    await expect(xDay).toContainText('Trending');
    await expect(xDay).toContainText('Expertise');
    await expect(visibleCard(page, '2026-10-01-3RD-X')).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });

  test('"Needs you this week" lists Update Chinese for 2 October first, as urgent', async ({ page }) => {
    await page.goto('/schedule');
    const strip = page.getByRole('region', { name: 'Needs you this week' });
    const first = strip.locator('[data-task-content-id]').first();
    await expect(first).toHaveAttribute('data-task-content-id', '2026-10-02-MAIN-X');
    await expect(first).toHaveAttribute('data-urgency', 'now');
    await expect(first).toContainText('! Urgent');
    await expect(first).toContainText('Fri 2 Oct');
    await expect(first.getByRole('link', { name: /^Update Chinese/ })).toBeVisible();
    await expect(strip.getByText(/open slots to fill/)).toBeVisible();
  });

  test('clicking an open slot card puts its Content ID in the URL for the panel', async ({ page }) => {
    await page.goto('/schedule?week=2026-10-01');
    const card = visibleCard(page, '2026-10-01-2ND-X');
    await expect(card).toContainText('Open · 20:00');
    await expect(card).toContainText('Fill');
    await card.getByRole('link').click();
    await expect(page).toHaveURL(/[?&]slot=2026-10-01-2ND-X(&|$)/);
    await expect(page).toHaveURL(/[?&]week=2026-10-01/);
  });

  test('an empty Threads slot reads "Waiting for X"', async ({ page }) => {
    await page.goto('/schedule?week=2026-10-01');
    await expect(visibleCard(page, '2026-10-03-MAIN-TH')).toContainText('Waiting for X');
  });

  test('month view shows filled/total per platform and a day opens its week', async ({ page }) => {
    await page.goto('/schedule?view=month&month=2026-10');
    const grid = page.getByTestId('month-grid');
    const oct1 = grid.locator('[data-date="2026-10-01"]');
    await expect(oct1).toContainText('X 1/2', { useInnerText: true });
    await expect(oct1).toContainText('Threads 1/2', { useInnerText: true });
    await expect(oct1).toContainText('LinkedIn 0/1', { useInnerText: true });
    const oct2 = grid.locator('[data-date="2026-10-02"]');
    await expect(oct2).toContainText('! 2', { useInnerText: true });
    await expect(grid.locator('[data-date="2026-09-30"]')).toContainText('Today', { useInnerText: true });
    await oct2.getByRole('link').click();
    await expect(page).toHaveURL(/view=week&week=2026-10-02/);
    await expect(page.getByTestId('week-grid')).toBeVisible();
    await expect(page.getByTestId('week-grid').locator('[data-day-header="2026-10-02"]')).toBeVisible();
  });

  test('Previous and Next move by a week, and Today comes back', async ({ page }) => {
    await page.goto('/schedule?week=2026-10-01');
    await page.getByRole('link', { name: 'Next week' }).click();
    await expect(page).toHaveURL(/week=2026-10-05/);
    await page.getByRole('link', { name: 'Today' }).click();
    await expect(page.getByTestId('week-grid').locator('[data-day-header="2026-09-30"]')).toContainText('Today');
  });

  for (const path of ['/schedule?view=week&week=2026-10-01', '/schedule?view=month&month=2026-10', '/schedule?view=list&week=2026-10-01']) {
    test(`UX-01: ${path} has no serious or critical axe violations at 1280 px`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState('load');
      await expectNoSeriousAxe(page);
    });
  }
});

test.describe('phone, 375 px', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('the week view becomes a list on a phone', async ({ page }) => {
    await page.goto('/schedule?week=2026-10-01');
    await expect(page.getByTestId('week-grid')).toBeHidden();
    await expect(page.getByRole('region', { name: 'Thursday 1 October' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('list view collapses runs of open slots and has no horizontal overflow', async ({ page }) => {
    await page.goto('/schedule?view=list&week=2026-10-01');
    const day = page.getByRole('region', { name: 'Thursday 1 October' });
    await expect(day).toBeVisible();
    await expect(day.locator('[data-content-id="2026-10-01-MAIN-X"]')).toContainText('Your first offer is a draft.');
    const run = day.locator('details[data-empty-run]');
    await expect(run).toHaveCount(1);
    const summary = run.locator('summary');
    await expect(summary).toHaveText(/3 open slots, 2 waiting for X/);
    // Closed disclosure: the Fill links exist but are not shown until it opens.
    await expect(run.locator('a')).toHaveCount(3);
    await expect(run.locator('a').first()).toBeHidden();
    await summary.click();
    await expect(run.getByRole('link', { name: /^Fill/ })).toHaveCount(2);
    await expect(run.getByRole('link', { name: /^Fill/ }).first()).toBeVisible();
    const box = await summary.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    // Days with nothing on them are left out.
    await expect(page.getByRole('region', { name: 'Monday 28 September' })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });

  test('month view fits a phone without horizontal overflow', async ({ page }) => {
    await page.goto('/schedule?view=month&month=2026-10');
    await expect(page.getByTestId('month-grid')).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  for (const path of ['/schedule?view=week&week=2026-10-01', '/schedule?view=month&month=2026-10', '/schedule?view=list&week=2026-10-01']) {
    test(`UX-01: ${path} has no serious or critical axe violations at 375 px`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState('load');
      await expectNoSeriousAxe(page);
    });
  }
});
