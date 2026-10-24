import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  expect((await page.request.post('/api/test-control', { data: { kind: 'reset' } })).status()).toBe(200);
  expect((await page.request.post('/api/test-auth', { data: { as: 'owner' } })).status()).toBe(200);
});

test('search pagination preserves keyboard focus while results load', async ({ page }) => {
  expect((await page.request.post('/api/test-control', { data: { kind: 'seed_library_pages' } })).status()).toBe(200);
  await page.goto('/backlog');
  await page.getByLabel('Find a post').fill('Synthetic body');
  await expect(page.getByText('45 posts · page 1 of 2')).toBeVisible();
  const next = page.getByRole('button', { name: 'Next page', exact: true });
  await next.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('45 posts · page 2 of 2')).toBeVisible();
  await expect(next).toBeFocused();
  await expect(next).toBeDisabled();
  await page.keyboard.press('Enter');
  await expect(page.getByText('45 posts · page 2 of 2')).toBeVisible();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'Previous page', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByText('45 posts · page 1 of 2')).toBeVisible();
});

test('2,000 posts keep the DOM bounded with global search, filters, sort and editable cells', async ({ page }, testInfo) => {
  expect((await page.request.post('/api/test-control', { data: { kind: 'seed_library_pages', total: 2000 } })).status()).toBe(200);
  await page.goto('/backlog');
  const region = page.getByRole('region', { name: 'Content Library posts' });
  const visibleRows = region.locator('[data-backlog-id]:visible');
  // Include the hidden responsive representation: 40 table rows + 40 cards.
  const allRows = region.locator('[data-backlog-id]');
  await expect(page.getByText('2000 posts · page 1 of 50')).toBeVisible();
  await expect(visibleRows).toHaveCount(40);
  await expect(allRows).toHaveCount(80);
  await expect(region.locator('tbody tr')).toHaveCount(40);
  await expect(region.locator('[data-backlog-id="SYN-B1988"]')).toHaveCount(0);
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('backlog-2000.png') });

  await page.getByRole('link', { name: 'Next page', exact: true }).click();
  await expect(page.getByText('2000 posts · page 2 of 50')).toBeVisible();
  await expect(allRows).toHaveCount(80);
  await page.getByLabel('Find a post').fill('Synthetic body 1988.');
  await expect(page.getByText('1 post · page 1 of 1')).toBeVisible();
  await expect(visibleRows).toHaveCount(1);
  await expect(visibleRows.first()).toHaveAttribute('data-backlog-id', 'SYN-B1988');
  expect(page.url()).not.toContain('1988');

  // Keyboard edit and consecutive saves use the existing revision-safe cell.
  const pesto = visibleRows.first().getByRole('combobox', { name: 'PESTO stage for SYN-B1988' });
  await pesto.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(visibleRows.first().getByRole('status')).toHaveText('Saved');
  await expect(pesto).toBeFocused();
  // A save must not steal focus back if the owner moves on while it is pending.
  let releaseSave!: () => void;
  const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
  await page.route('**/api/library/SYN-B1988/fields', async (route) => {
    await saveGate;
    await route.continue();
  });
  await pesto.selectOption('Expertise');
  await expect(pesto).toHaveValue('Expertise');
  await expect(pesto).toBeDisabled();
  await page.getByLabel('Find a post').focus();
  releaseSave();
  await expect(visibleRows.first().getByRole('status')).toHaveText('Saved');
  await expect(page.getByLabel('Find a post')).toBeFocused();

  await page.getByLabel('Find a post').fill('');
  await page.getByLabel('Platform', { exact: true }).selectOption('X');
  await page.getByLabel('Sort', { exact: true }).selectOption('');
  await page.getByRole('button', { name: /Switch to descending/ }).click();
  await expect(visibleRows.first()).toHaveAttribute('data-backlog-id', 'SYN-B1988');
  await expect(allRows).toHaveCount(80);
  await page.getByLabel('Find a post').fill('Synthetic body 1988.');
  await expect(page.getByText('1 post · page 1 of 1')).toBeVisible();
  await expect(visibleRows.first().getByRole('combobox')).toHaveValue('Expertise');
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(axe.violations).toEqual([]);
});
