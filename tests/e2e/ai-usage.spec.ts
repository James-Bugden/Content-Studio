import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  expect((await page.request.post('/api/test-control', { data: { kind: 'reset' } })).ok()).toBe(true);
  expect((await page.request.post('/api/test-auth', { data: { as: 'owner' } })).ok()).toBe(true);
});

test('AI button records tokens, account meter opens history, owner cap pauses generation', async ({ page }, info) => {
  await page.goto('/review/SYN-L001');
  const draft = page.getByLabel(/Post copy/);
  await expect(draft).toBeEditable();
  await draft.fill('Synthetic color for the usage check.');
  await page.getByRole('button', { name: 'Check English', exact: true }).click();
  await expect(page.locator('[data-finding]').first()).toBeVisible();
  await page.getByLabel('Account menu').click();
  await expect(page.getByRole('progressbar', { name: 'Monthly AI usage' })).toBeVisible();
  const recorded = await (await page.request.get('/api/ai-usage')).json();
  expect(recorded.calls).toHaveLength(1);
  expect(recorded.calls[0]).toMatchObject({ feature: 'english_qa', status: 'completed' });
  expect(recorded.calls[0].inputTokens).toBeGreaterThan(0);
  expect(recorded.calls[0].outputTokens).toBeGreaterThan(0);
  expect(recorded.spentMicros).toBeGreaterThan(0);
  await page.getByRole('link', { name: 'Usage and monthly limit' }).click();
  await expect(page.getByRole('heading', { name: 'AI usage', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Recent AI calls' })).toContainText('Check English');
  await page.getByLabel('Monthly limit (USD)').fill('0');
  await page.getByRole('button', { name: 'Save limit', exact: true }).click();
  await expect(page.getByText('Monthly limit saved.')).toBeVisible();
  await expect(page.getByText('Monthly AI limit reached', { exact: true }).last()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/ai-usage-${info.project.name}.png`, fullPage: true });
  await page.goto('/review/SYN-L001');
  await expect(draft).toBeEditable();
  const before = await draft.inputValue();
  await page.getByRole('button', { name: 'Check English', exact: true }).click();
  await expect(page.getByText('Monthly AI limit reached', { exact: true })).toBeVisible();
  await expect(draft).toBeEditable(); await expect(draft).toHaveValue(before);
  const refused = await (await page.request.get('/api/ai-usage')).json();
  expect(refused.calls).toHaveLength(1); expect(refused.spentMicros).toBe(recorded.spentMicros);
});

test('account meter warns at 80% and private usage rejects viewers and cross-origin cap writes', async ({ page }) => {
  await page.goto('/review/SYN-L001');
  await expect(page.getByLabel(/Post copy/)).toBeEditable();
  await page.getByLabel(/Post copy/).fill('Synthetic color for the warning check.');
  await page.getByRole('button', { name: 'Check English', exact: true }).click();
  await expect(page.locator('[data-finding]').first()).toBeVisible();
  const summary = await (await page.request.get('/api/ai-usage')).json();
  const origin = new URL(page.url()).origin;
  const change = { operationId: crypto.randomUUID(), expectedVersion: summary.version, capMicros: Math.floor(summary.spentMicros / 0.8) };
  expect((await page.request.patch('/api/ai-usage', { headers: { Origin: 'https://synthetic.invalid' }, data: change })).status()).toBe(403);
  expect((await page.request.patch('/api/ai-usage', { headers: { Origin: origin }, data: change })).ok()).toBe(true);
  await page.getByLabel('Account menu').click();
  await expect(page.getByText('80% of monthly AI limit used')).toBeVisible();
  await page.request.post('/api/test-auth', { data: { as: 'viewer' } });
  expect((await page.request.get('/api/ai-usage')).status()).toBe(403);
  expect((await page.request.patch('/api/ai-usage', { headers: { Origin: origin }, data: { ...change, operationId: crypto.randomUUID(), expectedVersion: summary.version + 1 } })).status()).toBe(403);
});
