import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const db = process.env.CS_E2E_CONTENT_STORE === 'db';
test('DB-7 body authority, failed Drive save and explicit Markdown import; Sheet retains its saga', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const control = async (data: object) => expect((await page.request.post('/api/test-control', { data })).status()).toBe(200);
  await control({ kind: 'reset' });
  await page.request.post('/api/test-auth', { data: { as: 'owner' } });
  if (db) {
    await page.goto('/reconcile');
    await expect(page.locator('[data-reconcile-kind="markdown_export_lag"]')).toHaveCount(0);
    await expect(page.locator('[data-reconcile-kind="markdown_missing"]').filter({ hasText: 'SYN-L003' })).toContainText('duplicate Drive sections');
  }
  await control({ kind: 'fail', provider: 'drive', op: 'read', code: 'NOT_FOUND', times: db ? 1 : 10 });
  await page.goto('/review/SYN-L008');
  if (!db) {
    await expect(page.getByRole('button', { name: 'Save draft' })).toBeDisabled();
    await page.goto('/reconcile');
    await expect(page.getByRole('heading', { name: 'Import Markdown master' })).toHaveCount(0);
    const refused = await page.request.post('/api/markdown-import', { data: { action: 'preview', link: 'SYNTH_master_negotiation_md' } });
    expect(refused.status()).toBe(403);
    return;
  }
  await expect(page.getByText('The database holds your saved draft.', { exact: false })).toHaveCount(0);
  await expect(page.getByText('Database; Drive is an export', { exact: true })).toBeVisible();
  await expect(page.getByText(/Invalid Date/)).toHaveCount(0);
  await page.getByLabel(/Post copy/).fill('## Unsafe section\n\nSynthetic body');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Not saved: the draft has a heading', { exact: false })).toBeVisible();
  await page.getByLabel(/Post copy/).fill('Synthetic DB body survives Drive failure 🙂');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Saved in the database. Drive export is queued.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel(/Post copy/)).toHaveValue('Synthetic DB body survives Drive failure 🙂');
  await page.screenshot({ path: `test-results/db-body-editor-${test.info().project.name}.png`, fullPage: true });
  await page.goto('/reconcile');
  const lag = page.locator('[data-reconcile-kind="markdown_export_lag"]');
  await expect(lag).toHaveCount(1);
  const lagItems = lag.locator(':scope > ul > li');
  await expect(lagItems).toHaveCount(1);
  await expect(lagItems).toContainText('SYN-L008: Drive export is behind');
  await expect(lagItems).toContainText('master or its unique section could not be found');
  await expect(lagItems.getByRole('link', { name: 'Review' })).toHaveAttribute('href', '/review/SYN-L008');
  await page.screenshot({ path: `test-results/db-body-lag-${test.info().project.name}.png`, fullPage: true });
  await expect(page.locator('[data-reconcile-kind="markdown_mismatch"]')).toHaveCount(0);

  await control({ kind: 'reset' });
  await control({ kind: 'db_external_edit', collection: 'library', id: 'SYN-L008', patch: { draftContent: 'Synthetic DB comparison body' } });
  await page.goto('/reconcile');
  await page.getByLabel('Drive master link').fill('SYNTH_master_negotiation_md');
  await page.getByRole('button', { name: 'Preview master' }).click();
  const section = page.getByRole('article', { name: 'Import SYN-L008', exact: true });
  await expect(section).toContainText('Bodies differ; choose a direction');
  await expect(section).toContainText('Synthetic DB comparison body');
  expect((await new AxeBuilder({ page }).include('[aria-labelledby="markdown-import-h"]').analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/db-body-import-${test.info().project.name}.png`, fullPage: true });
  await section.getByRole('button', { name: 'Keep database body' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Database body kept.' })).toBeVisible();
  await section.getByRole('button', { name: 'Use Markdown body' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Markdown section imported into the database.' })).toBeVisible();
  // Repeating the exact request in the existing preview is a ledger replay.
  await section.getByRole('button', { name: 'Use Markdown body' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Markdown section imported into the database.' })).toBeVisible();
  expect(errors).toEqual([]);
});
