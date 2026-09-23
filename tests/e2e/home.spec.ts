import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Next up home page (UX redesign) against the synthetic fakes (CS_FAKE_TODAY 2026-09-30).
 * The empty state is covered by tests/unit/components/next-up-view.test.tsx.
 */
async function signInAs(request: APIRequestContext, as: 'owner' | 'viewer') {
  expect((await request.post('/api/test-auth', { data: { as } })).status()).toBe(200);
}

test.beforeEach(async ({ page }) => {
  expect((await page.request.post('/api/test-control', { data: { kind: 'reset' } })).status()).toBe(200);
});

test('UX-01: signed-in / shows Next up with tiles, counts and the urgent tasks', async ({ page }) => {
  await signInAs(page.request, 'owner');
  await page.goto('/');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Next up', level: 1 })).toBeVisible();
  await expect(page.getByText('Here is what needs you')).toBeVisible();
  await expect(page.getByText('Wednesday 30 September 2026')).toBeVisible();

  const summary = page.getByRole('region', { name: 'Summary' });
  await expect(summary.getByRole('link', { name: /To review/ })).toContainText('3');
  await expect(summary.getByRole('link', { name: /Images to finish/ })).toContainText('3');
  await expect(summary.getByRole('link', { name: /Ready to schedule/ })).toContainText('3');
  await expect(summary.getByRole('link', { name: /Open slots this week/ })).toContainText('8');
  await expect(summary.getByRole('link', { name: /To review/ })).toHaveAttribute('href', '/review?lane=review');

  const now = page.getByRole('region', { name: /Do these now/ });
  for (const action of ['Update Chinese', 'Rework copy', 'Decide duplicate']) {
    await expect(now.getByRole('link', { name: new RegExp(`^${action}`) }).first()).toBeVisible();
  }
  await expect(now.getByText('Quoted framework')).toBeVisible();
  await expect(now.getByText('X, Fri 2 Oct, 08:00')).toBeVisible();
  // Titles, never ids.
  expect(await page.locator('main').innerText()).not.toMatch(/SYN-L0|2026-10-0\d-MAIN/);

  const next = page.getByRole('region', { name: /^Next/ });
  await expect(next.getByText('Negotiate scope first')).toBeVisible();
  await expect(next.getByText('LinkedIn, Thu 1 Oct, 21:00')).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('UX-01: a task button opens the panel on the post or the slot', async ({ page }) => {
  await signInAs(page.request, 'owner');
  await page.goto('/');
  const now = page.getByRole('region', { name: /Do these now/ });
  await now.getByRole('link', { name: /^Rework copy/ }).click();
  await expect(page).toHaveURL(/\/\?post=SYN-L002$/);
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await expect(page).not.toHaveURL(/post=/);
  await now.getByRole('link', { name: /^Update Chinese/ }).first().click();
  await expect(page).toHaveURL(/\/\?slot=2026-10-02-MAIN-X$/);
  expect(new URL(page.url()).searchParams.has('post')).toBe(false);
});

test('UX-01: the viewer sees Next up too', async ({ page }) => {
  await signInAs(page.request, 'viewer');
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Next up', level: 1 })).toBeVisible();
  await expect(page.getByRole('region', { name: /Do these now/ })).toBeVisible();
});

test('UX-01: / and /review have no serious or critical axe violations', async ({ page }) => {
  await signInAs(page.request, 'owner');
  for (const path of ['/', '/review']) {
    await page.goto(path);
    await page.waitForLoadState('load');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => `${path} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`)).toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${path} overflows`).toBeLessThanOrEqual(0);
  }
});
