import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.skip(process.env.CS_E2E_CONTENT_STORE !== 'db', 'Image pipeline uses the database authority.');
test.beforeEach(async ({ page }) => {
  expect((await page.request.post('/api/test-control', { data: { kind: 'reset' } })).status()).toBe(200);
  expect((await page.request.post('/api/test-auth', { data: { as: 'owner' } })).status()).toBe(200);
});

test('bulk check images, approve a sketch, render and bulk create at phone and desktop widths', async ({ page }) => {
  await page.goto('/backlog');
  const rows = page.locator('[data-backlog-id]:visible');
  await expect(rows.first()).toBeVisible();
  const firstId = await rows.first().getAttribute('data-backlog-id');
  const secondId = await rows.nth(1).getAttribute('data-backlog-id');
  await rows.first().getByRole('checkbox').check();
  await rows.nth(1).getByRole('checkbox').check();
  const bar = page.getByLabel('Image selection');
  await expect(bar.getByRole('status')).toHaveText('2 selected');
  await bar.getByRole('button', { name: 'Check images' }).click();
  await expect(page.getByText('2 completed, 0 failed.', { exact: true })).toBeVisible();
  await expect(rows.first().getByRole('status')).toContainText('Needs image:');
  await expect(rows.first().getByRole('status')).toContainText('3 sketch options');
  await page.screenshot({ path: test.info().outputPath('image-selection.png'), fullPage: false });
  await rows.first().getByRole('link', { name: /^Edit / }).click();
  const panel = page.getByRole('dialog');
  await expect(panel.getByRole('list', { name: 'Sketch options' })).toBeVisible();
  await panel.getByRole('list', { name: 'Sketch options' }).scrollIntoViewIfNeeded();
  expect((await new AxeBuilder({ page }).include('[aria-labelledby="image-section-heading"]').analyze()).violations).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('image-sketch.png'), fullPage: false });
  await panel.getByRole('button', { name: /^Make image from/ }).first().click();
  await expect(panel.getByText(/Image made\./)).toBeVisible();
  const imagePreview = panel.getByRole('img', { name: 'The image made from the chosen sketch' });
  await expect(imagePreview).toBeVisible();
  await expect.poll(() => imagePreview.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  const first = await page.request.get(`/api/images?id=${firstId}`);
  expect((await first.json()).image.hasImage).toBe(true);
  // Approve the second exact plan through the same guarded API, leaving it for
  // the bulk create action. First image remains selected as a valid retry.
  const second = (await (await page.request.get(`/api/images?id=${secondId}`)).json()).image;
  const approved = await page.request.post('/api/images', { headers: { origin: new URL(page.url()).origin }, data: {
    action: 'approve', libraryId: secondId, expectedRevision: second.revision, operationId: 'image_e2e_approve_second',
  } });
  expect(approved.status()).toBe(200);
  await panel.getByRole('button', { name: /Close/ }).first().click();
  // Reload revisions from the bounded page after the API approval.
  await page.goto('/backlog');
  await page.locator(`[data-backlog-id="${secondId}"]:visible`).getByRole('checkbox').check();
  await page.getByLabel('Image selection').getByRole('button', { name: 'Create images' }).click();
  await expect(page.getByText('1 completed, 0 failed.', { exact: true })).toBeVisible();
  expect((await (await page.request.get(`/api/images?id=${secondId}`)).json()).image.hasImage).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const width of [500, 750]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByLabel('Image selection')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
  await expect(page.getByLabel('Image selection')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('image-selection-200-percent.png'), fullPage: false });
});

test('bulk partial failure is explicit and viewer cannot check images', async ({ page }) => {
  await page.goto('/backlog');
  const rows = page.locator('[data-backlog-id]:visible');
  await rows.first().getByRole('checkbox').check();
  await rows.nth(1).getByRole('checkbox').check();
  expect((await page.request.post('/api/test-control', { data: { kind: 'ai_fail', code: 'AI_LIMIT_REACHED' } })).status()).toBe(200);
  await page.getByLabel('Image selection').getByRole('button', { name: 'Check images' }).click();
  await expect(page.getByText('1 completed, 1 failed.', { exact: true })).toBeVisible();
  await expect(page.locator('[data-backlog-id]:visible').getByText('Monthly AI limit reached', { exact: true })).toBeVisible();
  await page.request.post('/api/test-auth', { data: { as: 'viewer' } });
  await page.goto('/backlog');
  await expect(page.getByLabel('Image selection')).toHaveCount(0);
});
