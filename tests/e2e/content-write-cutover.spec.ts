import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('MIG-12: an edited no-link DB draft names Restore Drive link without an impossible export job', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const control = async (data: object) => expect((await page.request.post('/api/test-control', { data })).status()).toBe(200);
  await control({ kind: 'reset' });
  expect((await page.request.post('/api/test-auth', { data: { as: 'owner' } })).status()).toBe(200);
  await control({ kind: 'db_external_edit', collection: 'library', id: 'SYN-L001', patch: { sourceMarkdown: '', sourceMasterFile: '' } });
  await page.goto('/review/SYN-L001');
  await page.getByLabel(/Post copy/).fill('Synthetic no-link database draft');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Saved in the database. Drive export is queued.')).toBeVisible();
  await page.goto('/reconcile');
  const recovery = page.locator('[data-reconcile-kind="markdown_missing"]').filter({ hasText: 'SYN-L001' });
  await expect(recovery).toContainText('blocking');
  await expect(recovery.getByRole('link', { name: 'Restore Drive link' })).toHaveAttribute('href', '/review/SYN-L001');
  await expect(recovery).toContainText('coordinator to restore its link');
  expect((await new AxeBuilder({ page }).include('[data-reconcile-kind="markdown_missing"]').analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/no-link-recovery-${test.info().project.name}.png`, fullPage: true });
  expect(errors).toEqual([]);
});

test('DB-only saves and all content pages ignore Sheet edits and outages', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const control = async (data: object) => expect((await page.request.post('/api/test-control', { data })).status()).toBe(200);
  await control({ kind: 'reset' });
  expect((await page.request.post('/api/test-auth', { data: { as: 'owner' } })).status()).toBe(200);
  await control({ kind: 'fail', provider: 'sheet', op: 'read', code: 'PROVIDER_UNAVAILABLE', times: 10 });
  await control({ kind: 'fail', provider: 'sheet', op: 'write', code: 'PROVIDER_UNAVAILABLE', times: 10 });
  await control({ kind: 'sheet_edit', libraryId: 'SYN-L001', header: 'Draft Content', value: 'Synthetic obsolete Sheet copy' });
  await page.goto('/review/SYN-L001');
  await page.getByLabel(/Post copy/).fill('Synthetic database-only saved copy  ');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Saved in the database. Drive export is queued.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel(/Post copy/)).toHaveValue('Synthetic database-only saved copy  ');
  await page.goto('/reconcile');
  await expect(page.getByText('Store mode: db. Database is the only content store.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Database switch' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Run content import' })).toHaveCount(0);
  await expect(page.locator('[data-reconcile-kind="export_parity"], [data-reconcile-kind="export_mismatch"]')).toHaveCount(0);
  expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const timing: Record<string, number> = {};
  for (const route of ['/backlog', '/', '/review', '/schedule', '/backlog?view=ideas', '/ready', '/published', '/replies']) {
    expect((await page.request.get(route)).status()).toBe(200);
    const start = performance.now();
    expect((await page.request.get(route)).status()).toBe(200);
    timing[route] = Math.round(performance.now() - start);
  }
  console.info('DB-only fake warm HTTP ms', JSON.stringify(timing));
  for (const route of ['/backlog', '/', '/review', '/schedule']) expect(timing[route]).toBeLessThan(1000);
  const stats = await page.request.post('/api/test-control', { data: { kind: 'store_stats' } });
  expect(await stats.json()).toEqual({ sheetReads: 0, sheetWrites: 0 });
  await page.screenshot({ path: `test-results/db-only-${test.info().project.name}.png`, fullPage: true });
  expect(errors).toEqual([]);
});
