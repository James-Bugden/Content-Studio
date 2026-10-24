import { expect, test } from '@playwright/test';

test('Sheet reconcile keeps typed imports inactive', async ({ page }) => {
  await page.request.post('/api/test-control', { data: { kind: 'reset' } });
  await page.request.post('/api/test-auth', { data: { as: 'owner' } });
  await page.goto('/reconcile');
  const report = page.getByRole('region', { name: 'Content import and parity' });
  await expect(report).toContainText('Store mode: sheet');
  await expect(report).toContainText('Typed import and shadow comparison are inactive');
  await expect(report.getByRole('button', { name: 'Run content import' })).toHaveCount(0);
});
