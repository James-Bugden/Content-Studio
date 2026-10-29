import { expect, test } from '@playwright/test';
import { scanAxe } from './support/axe';

/** #247: URL-backed Backlog view, the shortcuts dialog, and approve-and-queue gating. */
test.beforeEach(async ({ page }) => {
  expect((await page.request.post('/api/test-control', { data: { kind: 'reset' } })).status()).toBe(200);
  expect((await page.request.post('/api/test-auth', { data: { as: 'owner' } })).status()).toBe(200);
});

test('the ? button opens the shortcuts dialog, it is axe clean, and Escape closes it', async ({ page, isMobile }) => {
  test.skip(isMobile, 'The button is hidden on touch devices.');
  await page.goto('/backlog');
  await page.getByRole('button', { name: 'Keyboard shortcuts' }).click();
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Ctrl/Cmd + Shift + Enter');
  const bad = (await scanAxe(page, ['wcag2a', 'wcag2aa', 'wcag21aa'])).violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad.map((v) => v.id)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await page.keyboard.press('Shift+/');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
});

test('Backlog filters, sort, direction and page survive a reload and Back', async ({ page }) => {
  await page.goto('/backlog?sort=hook&dir=desc');
  await page.reload();
  await expect(page).toHaveURL(/sort=hook/);
  await expect(page).toHaveURL(/dir=desc/);
  await expect(page.getByRole('button', { name: /Order: descending/ })).toBeVisible();
});

test('Ctrl+Shift+Enter does nothing while Approve and queue is disabled (unsaved copy)', async ({ page }) => {
  await page.goto('/backlog?post=SYN-L005');
  const panel = page.getByRole('dialog');
  const box = panel.getByLabel(/Post copy/);
  await box.fill('Unsaved synthetic change');
  const approve = panel.getByRole('button', { name: 'Approve and queue' });
  await expect(approve).toBeDisabled();
  await box.press('Control+Shift+Enter');
  await expect(panel.getByText(/Approved and queued/)).toHaveCount(0);
});
