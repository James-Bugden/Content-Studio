import { expect, test } from '@playwright/test';
import { scanAxe } from './support/axe';

test.beforeEach(async ({ page }) => {
  expect((await page.request.post('/api/test-control', { data: { kind: 'reset' } })).status()).toBe(200);
  expect((await page.request.post('/api/test-auth', { data: { as: 'owner' } })).status()).toBe(200);
});

test('panel compacts copy, requests changes without losing edits, saves and approves the saved copy', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/backlog?post=SYN-L008');
  const panel = page.getByRole('dialog');
  const copy = panel.getByLabel(/Post copy/);
  const text = 'Synthetic hook.\n\nFirst sentence.\n\nSecond sentence.\n\nThird sentence.\n\nFourth sentence.';
  await copy.fill(text);
  await panel.getByRole('button', { name: 'Fewer line breaks' }).click();
  const compact = 'Synthetic hook.\n\nFirst sentence. Second sentence. Third sentence.\n\nFourth sentence.';
  await expect(copy).toHaveValue(compact);
  await expect(panel.getByText('4 fewer line breaks')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Approve only', exact: true })).toBeDisabled();
  await panel.getByRole('button', { name: 'Request changes', exact: true }).click();
  await expect(panel.getByRole('status').filter({ hasText: 'Changes requested.' })).toBeVisible();
  await expect(copy).toHaveValue(compact);
  await panel.getByRole('button', { name: 'Save before approving', exact: true }).click();
  await expect(panel.getByText(/Saved in the database|Saved to the master Markdown/)).toBeVisible();
  await expect(copy).toHaveValue(compact);
  await panel.getByRole('button', { name: 'Approve only', exact: true }).click();
  await expect(panel.getByRole('status').filter({ hasText: 'Approved.' })).toBeVisible();
  const saved = (await (await page.request.get('/api/library/SYN-L008/editor')).json()).model;
  expect(saved.sheet.draft).toBe(compact);
  expect(saved.reviewStatus).toBe('Approved');
  expect(errors).toEqual([]);
});

test('image judgement and reason can be changed inline, including at phone widths', async ({ page }) => {
  await page.goto('/backlog?post=SYN-L008');
  const panel = page.getByRole('dialog');
  const image = panel.getByRole('region', { name: 'Image', exact: true });
  await expect(image.getByRole('heading', { name: 'Image', exact: true })).toBeVisible();
  await image.getByRole('button', { name: 'Needs an image', exact: true }).click();
  await expect(image.getByRole('button', { name: 'Complete image brief' })).toBeVisible();
  await image.getByRole('textbox', { name: 'Image reason', exact: true }).fill('Compare the two options visually.');
  await image.getByRole('button', { name: 'Save image reason', exact: true }).click();
  await expect(image.getByText('Compare the two options visually.', { exact: true })).toBeVisible();
  await image.getByRole('button', { name: 'Edit image brief', exact: true }).click();
  await expect(image.getByLabel('ASCII plan', { exact: true })).toBeVisible();
  await image.locator('summary').filter({ hasText: 'Image decision, brief and review' }).click();
  await image.getByRole('button', { name: 'Mark no image', exact: true }).click();
  await expect(image.getByText('No image needed', { exact: true })).toBeVisible();
  await expect(image.getByText('Compare the two options visually.', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/backlog\?post=SYN-L008/);
  expect(await panel.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  const result = await scanAxe(page, ['wcag2a', 'wcag2aa', 'wcag21aa']);
  expect(result.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
  await image.evaluate(el => el.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: `test-results/panel-polish-${test.info().project.name}.png` });
});

test('approval blocker links lead to editable QA decisions', async ({ page }) => {
  await page.goto('/backlog?post=SYN-L002');
  const panel = page.getByRole('dialog');
  await expect(panel.getByRole('button', { name: 'Approve only', exact: true })).toBeDisabled();
  await expect(panel.getByRole('button', { name: 'Request changes', exact: true })).toBeEnabled();
  await panel.getByRole('button', { name: 'AI', exact: true }).click();
  await panel.getByRole('link', { name: 'Rework the copy, then re-run copyright QA', exact: true }).click();
  const copyright = panel.getByRole('combobox', { name: 'Copyright QA', exact: true });
  await expect(copyright).toBeVisible();
  await copyright.selectOption('PASS');
  await expect(copyright).toHaveValue('PASS');
  await expect(panel.getByRole('link', { name: 'Rework the copy, then re-run copyright QA', exact: true })).toHaveCount(0);
});

test('collapsing image controls preserves an unsaved brief and blocks conflicting image changes', async ({ page }) => {
  await page.goto('/backlog?post=SYN-L008');
  const image = page.getByRole('region', { name: 'Image', exact: true });
  await image.getByRole('button', { name: 'Needs an image', exact: true }).click();
  await image.getByRole('button', { name: 'Edit image brief', exact: true }).click();
  const lesson = image.getByLabel('Lesson', { exact: true });
  await lesson.fill('Synthetic unsaved visual lesson.');
  const summary = image.locator('summary').filter({ hasText: 'Image decision, brief and review' });
  await summary.click();
  await expect(image.getByRole('button', { name: 'Mark no image', exact: true })).toBeDisabled();
  await image.getByRole('button', { name: 'Continue editing', exact: true }).click();
  await expect(lesson).toHaveValue('Synthetic unsaved visual lesson.');
});
