import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('MIG-09/10 reconcile exposes mode, measurements, import evidence and a safe retry at both widths', async ({ page }) => {
  expect((await page.request.post('/api/test-control', { data: { kind: 'reset' } })).status()).toBe(200);
  expect((await page.request.post('/api/test-auth', { data: { as: 'owner' } })).status()).toBe(200);
  await page.goto('/reconcile');
  const report = page.getByRole('region', { name: 'Content import and parity' });
  await expect(report).toContainText('Store mode: db-shadow');
  await expect(report).toContainText('not measured');
  await expect(report).toContainText('this server instance');
  await report.getByRole('button', { name: 'Run content import' }).click();
  await expect(report.getByRole('status')).toHaveText('Content import completed.');
  await expect(report).toContainText('import lag p95: 0 min');
  await report.getByText('Last import counts, hashes and exceptions').click();
  await expect(report).toContainText('classified exceptions');
  await expect(report).toContainText(/library: \d+ rows/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include('[aria-labelledby="content-parity-h"]').analyze()).violations).toEqual([]);
  await page.screenshot({ path: `test-results/content-parity-${test.info().project.name}.png`, fullPage: true });
});
