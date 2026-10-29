import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * #248: the image check stores ranked ASCII sketch options on the post and the
 * panel's Image section shows them. Uses the fake AI and renderer only. Runs at
 * phone (375) and desktop (1280) widths.
 */
test.skip(process.env.CS_E2E_CONTENT_STORE !== 'db', 'Sketch options use the database authority.');
test.beforeEach(async ({ page }) => {
  expect((await page.request.post('/api/test-control', { data: { kind: 'reset' } })).status()).toBe(200);
  expect((await page.request.post('/api/test-auth', { data: { as: 'owner' } })).status()).toBe(200);
});

for (const viewport of [{ name: 'phone', width: 375, height: 812 }, { name: 'desktop', width: 1280, height: 900 }]) {
  test(`options appear in the panel, More options appends, Make image renders (${viewport.name})`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/backlog');
    const rows = page.locator('[data-backlog-id]:visible');
    await expect(rows.first()).toBeVisible();
    const id = (await rows.first().getAttribute('data-backlog-id'))!;
    // One AI call per post: the check stores the verdict and the options.
    const current = (await (await page.request.get(`/api/images?id=${id}`)).json()).image;
    const checked = await page.request.post('/api/images', { headers: { origin: new URL(page.url()).origin }, data: {
      action: 'check', libraryId: id, expectedRevision: current.revision, operationId: `sketch_options_check_${viewport.name}`,
    } });
    expect(checked.status()).toBe(200);
    expect((await checked.json()).image.options).toHaveLength(3);

    await page.goto('/backlog');
    await page.locator(`[data-backlog-id="${id}"]:visible`).getByRole('link', { name: /^Edit / }).click();
    const panel = page.getByRole('dialog');
    const list = panel.getByRole('list', { name: 'Sketch options' });
    await expect(list).toBeVisible();
    await expect(list.getByRole('listitem')).toHaveCount(3);
    await expect(panel.getByText('Needs an image', { exact: true })).toBeVisible();
    await list.scrollIntoViewIfNeeded();
    expect((await new AxeBuilder({ page }).include('[aria-labelledby="image-section-heading"]').analyze()).violations).toEqual([]);

    // The sketch boxes scroll inside the card instead of widening the page.
    for (const pre of await list.locator('pre').all()) {
      const box = (await pre.boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`sketch-options-${viewport.name}.png`), fullPage: false });

    await panel.getByRole('button', { name: 'More options' }).click();
    await expect(list.getByRole('listitem')).toHaveCount(6);
    await expect(panel.getByRole('button', { name: 'More options' })).toBeVisible();

    await list.getByRole('button', { name: /^Make image from/ }).first().click();
    await expect(panel.getByText(/Image made\./)).toBeVisible();
    await expect(list.locator('[data-chosen="true"]')).toHaveCount(1);
    const image = panel.getByRole('img', { name: 'The image made from the chosen sketch' });
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await expect(panel.getByRole('button', { name: 'Download' })).toBeVisible();
    expect((await (await page.request.get(`/api/images?id=${id}`)).json()).image).toMatchObject({ hasImage: true, approval: 'approved' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('a refused cap shows the existing message and keeps the options', async ({ page }) => {
  await page.goto('/backlog');
  const rows = page.locator('[data-backlog-id]:visible');
  await expect(rows.first()).toBeVisible();
  const id = (await rows.first().getAttribute('data-backlog-id'))!;
  const current = (await (await page.request.get(`/api/images?id=${id}`)).json()).image;
  await page.request.post('/api/images', { headers: { origin: new URL(page.url()).origin }, data: {
    action: 'check', libraryId: id, expectedRevision: current.revision, operationId: 'sketch_options_cap_check',
  } });
  await page.goto('/backlog');
  await page.locator(`[data-backlog-id="${id}"]:visible`).getByRole('link', { name: /^Edit / }).click();
  const panel = page.getByRole('dialog');
  const list = panel.getByRole('list', { name: 'Sketch options' });
  await expect(list.getByRole('listitem')).toHaveCount(3);
  expect((await page.request.post('/api/test-control', { data: { kind: 'ai_fail', code: 'AI_LIMIT_REACHED' } })).status()).toBe(200);
  await list.getByRole('button', { name: /^Make image from/ }).first().click();
  await expect(panel.getByText(/Monthly AI limit reached/)).toBeVisible();
  await expect(list.getByRole('listitem')).toHaveCount(3);
});
