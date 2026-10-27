import { test, expect } from '@playwright/test';
import { scanAxe } from './support/axe';

test.skip(process.env.CS_E2E_CONTENT_STORE !== 'db', 'Platform drafts and deletion use the database authority.');
test.beforeEach(async ({ page }) => {
  const request = page.request;
  expect((await request.post('/api/test-control', { data: { kind: 'reset' } })).status()).toBe(200);
  expect((await request.post('/api/test-auth', { data: { as: 'owner' } })).status()).toBe(200);
});

test('English edits update all previews immediately and selected versions survive reopening', async ({ page }) => {
  await page.goto('/backlog?post=SYN-L001');
  const panel = page.getByRole('dialog');
  const text = 'A synthetic English paragraph.\nA second line.\n\nOne next step.';
  await panel.getByLabel(/Post copy/).fill(text);
  await panel.getByRole('button', { name: 'Preview X', exact: true }).click();
  await expect(panel.getByRole('article', { name: 'Preview on X' })).toContainText('A synthetic English paragraph.');
  await panel.getByRole('button', { name: 'Preview Threads', exact: true }).click();
  await expect(panel.getByRole('article', { name: 'Preview on Threads' })).toContainText('A second line.');
  await panel.getByRole('button', { name: 'Preview LinkedIn', exact: true }).click();
  await expect(panel.getByRole('article', { name: 'Preview on LinkedIn' })).toContainText('One next step.');
  const saveAs = panel.getByRole('group', { name: 'Save as', exact: true });
  await saveAs.getByRole('checkbox', { name: 'X', exact: true }).check();
  await saveAs.getByRole('checkbox', { name: 'Threads', exact: true }).check();
  await panel.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(panel.getByText('Saved in the database. Drive export is queued.')).toBeVisible();
  const saved = await (await page.request.get('/api/library/SYN-L001/editor')).json();
  expect(saved.model.versions.map((v: { platform: string }) => v.platform).sort()).toEqual(['LinkedIn', 'Threads', 'X']);
  expect(saved.model.versions.every((v: { english: string }) => v.english === text)).toBe(true);
  await panel.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Content Library posts' })).toBeVisible();
  await page.screenshot({ path: `artifacts/237/backlog-${test.info().project.name}.png`, fullPage: true });
  await page.goto('/backlog?post=SYN-L001');
  await expect(panel.getByLabel(/Post copy/)).toHaveValue(text);
  await expect(panel.getByRole('group', { name: 'Save as', exact: true }).getByRole('checkbox', { name: 'X', exact: true })).toBeChecked();
  expect(await panel.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  if (test.info().project.name === 'w1280') {
    const editor = await panel.getByLabel(/Post copy/).boundingBox();
    const preview = await panel.getByRole('article', { name: 'Preview on LinkedIn' }).boundingBox();
    expect(preview!.x).toBeGreaterThan(editor!.x + editor!.width);
  }
  await page.screenshot({ path: `artifacts/237/post-editor-${test.info().project.name}.png` });
  await panel.getByRole('article', { name: 'Preview on LinkedIn' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `artifacts/237/post-preview-${test.info().project.name}.png` });
});

test('Chinese generation is reviewable and a later English edit blocks saving the stale adaptation', async ({ page }) => {
  await page.goto('/backlog?post=SYN-L001');
  const panel = page.getByRole('dialog');
  const source = 'A synthetic English source for a Chinese draft.';
  await panel.getByLabel(/Post copy/).fill(source);
  await panel.getByRole('checkbox', { name: 'Chinese from English', exact: true }).check();
  await expect(panel.getByRole('button', { name: 'Save draft', exact: true })).toBeDisabled();
  await panel.getByRole('button', { name: 'Generate Chinese', exact: true }).click();
  const chinese = panel.getByRole('textbox', { name: 'Chinese review draft', exact: true });
  await expect(chinese).not.toHaveValue('');
  await panel.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(panel.getByText('Saved in the database. Drive export is queued.')).toBeVisible();
  const saved = await (await page.request.get('/api/library/SYN-L001/editor')).json();
  expect(saved.model.versions[0].chinese).toBe(await chinese.inputValue());
  await panel.getByLabel(/Post copy/).fill(`${source} Changed.`);
  await expect(panel.getByText('English changed. Regenerate Chinese before saving.')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Save draft', exact: true })).toBeDisabled();
});

test('Delete closes the panel, removes the post and Undo restores its saved copy', async ({ page }) => {
  await page.goto('/backlog?post=SYN-L001');
  const panel = page.getByRole('dialog');
  const before = await panel.getByLabel(/Post copy/).inputValue();
  await panel.getByRole('button', { name: 'Delete post', exact: true }).click();
  await expect(panel).not.toBeVisible();
  await expect(page).toHaveURL(/\/backlog$/);
  expect((await page.request.get('/api/library/SYN-L001/editor')).status()).toBe(404);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Notifications' })).toContainText('Post restored.');
  expect((await (await page.request.get('/api/library/SYN-L001/editor')).json()).model.sheet.draft).toBe(before);
});

test('Delete and Undo refresh private search results while preserving the query', async ({ page }) => {
  await page.goto('/backlog');
  const search = page.getByLabel('Find a post');
  await search.fill('Scope decides the salary band.');
  await expect(page.getByText('1 post · page 1 of 1.', { exact: true })).toBeVisible();
  const row = page.locator('[data-backlog-id="SYN-L001"]:visible');
  await expect(row).toBeVisible();
  await row.getByRole('link', { name: 'Show full post', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete post', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByText('No items match these filters', { exact: true })).toBeVisible();
  await expect(page.getByText('0 posts · page 1 of 1.', { exact: true })).toBeVisible();
  await expect(row).toHaveCount(0);
  await expect(search).toHaveValue('Scope decides the salary band.');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Notifications' })).toContainText('Post restored.');
  await expect(row).toBeVisible();
  await expect(search).toHaveValue('Scope decides the salary band.');
  expect(page.url()).not.toContain('salary');
});

test('new APIs require owner and same-origin and never accept stale platform saves', async ({ page }) => {
  const model = (await (await page.request.get('/api/library/SYN-L001/editor')).json()).model;
  const data = { operationId: 'synthetic_e2e_versions', expectedRevision: model.sheet.revision, proposed: 'Synthetic next version', platforms: ['X'] };
  const url = '/api/library/SYN-L001/versions';
  const origin = new URL(test.info().project.use.baseURL!).origin;
  expect((await page.request.post(url, { headers: { origin: 'https://different.example' }, data })).status()).toBe(403);
  expect((await page.request.post(url, { headers: { origin }, data })).status()).toBe(200);
  expect((await page.request.post(url, { headers: { origin }, data: { ...data, operationId: 'synthetic_e2e_stale', proposed: 'An older tab' } })).status()).toBe(409);
  await page.request.post('/api/test-auth', { data: { as: 'viewer' } });
  for (const action of ['versions', 'lifecycle', 'chinese']) expect((await page.request.post(`/api/library/SYN-L001/${action}`, { headers: { origin }, data })).status()).toBe(403);
});

test('editor reflows at intermediate widths with no serious accessibility violations', async ({ page }) => {
  await page.goto('/backlog?post=SYN-L001');
  const panel = page.getByRole('dialog');
  await expect(panel.getByLabel(/Post copy/)).toBeVisible();
  for (const width of [375, 500, 640, 750, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await panel.evaluate(el => el.scrollWidth - el.clientWidth), `panel at ${width}px`).toBeLessThanOrEqual(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `page at ${width}px`).toBeLessThanOrEqual(0);
    if (width === 375 || width === 1280) {
      const result = await scanAxe(page, ['wcag2a', 'wcag2aa', 'wcag21aa']);
      expect(result.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
    }
  }
});
