import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * UX redesign: the side panel lets a post be read, edited, formatted, approved
 * and scheduled in place, from any page, via `?post=` / `?slot=`.
 */
async function signInAs(request: APIRequestContext, as: 'owner' | 'viewer') {
  expect((await request.post('/api/test-auth', { data: { as } })).status()).toBe(200);
}

test.beforeEach(async ({ page }) => {
  expect((await page.request.post('/api/test-control', { data: { kind: 'reset' } })).status()).toBe(200);
  await signInAs(page.request, 'owner');
});

test('the post panel previews, approves and queues without leaving the page', async ({ page }) => {
  await page.goto('/review?post=SYN-L001');
  const panel = page.getByRole('dialog');
  await expect(panel.getByRole('heading', { name: /negotiate scope first/i })).toBeVisible();
  await expect(panel.getByRole('article', { name: 'Preview on LinkedIn' })).toContainText('The best candidates negotiate the scope first.');
  await panel.getByRole('button', { name: 'Approve and queue' }).click();
  await expect(panel.getByText('Approved and queued for scheduling.')).toBeVisible();
  await expect(panel.getByText(/Next\s+Schedule/)).toBeVisible();
  await panel.getByRole('button', { name: 'Close' }).click();
  await expect(page).not.toHaveURL(/post=/);
});

test('a Ready post can be scheduled from the panel', async ({ page }) => {
  await page.goto('/review?post=SYN-L005');
  const panel = page.getByRole('dialog');
  await panel.getByRole('button', { name: /Thu 1 Oct · 21:00/ }).click();
  await expect(panel.getByText('These cells will be written to the Schedule. Nothing else changes.')).toBeVisible();
  await panel.getByRole('button', { name: /Confirm and write to 2026-10-01-MAIN-LI/ }).click();
  await expect(panel.getByText(/Scheduled into 2026-10-01-MAIN-LI/)).toBeVisible();
});

test('an open slot is filled from the calendar panel', async ({ page }) => {
  await page.goto('/schedule?week=2026-10-01&slot=2026-10-01-MAIN-LI');
  const panel = page.getByRole('dialog');
  await expect(panel.getByRole('heading', { name: 'Fill this slot' })).toBeVisible();
  await panel.getByRole('listitem').filter({ hasText: /counteroffer/i }).getByRole('button', { name: 'Use this' }).click();
  await panel.getByRole('button', { name: /Confirm and write to 2026-10-01-MAIN-LI/ }).click();
  await expect(panel.getByText(/Scheduled into 2026-10-01-MAIN-LI/)).toBeVisible();
});

test('formatting uses platform-safe characters and Markdown can be cleaned up', async ({ page }) => {
  await page.goto('/review?post=SYN-L001');
  const panel = page.getByRole('dialog');
  await panel.getByRole('tab', { name: 'Edit' }).click();
  const box = panel.getByLabel(/Post copy/);
  await box.fill('**Scope** first\n- budget\n- value');
  await expect(panel.getByText(/This text contains Markdown/)).toBeVisible();
  await panel.getByRole('button', { name: 'Clean up Markdown' }).click();
  await expect(box).toHaveValue('𝗦𝗰𝗼𝗽𝗲 first\n• budget\n• value');
  await expect(panel.getByText(/This text contains Markdown/)).toHaveCount(0);
  // Bold toggles the word under the cursor.
  await box.fill('Scope first');
  await box.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(0, 5));
  await panel.getByRole('button', { name: 'Bold (Unicode letters)' }).click();
  await expect(box).toHaveValue('𝗦𝗰𝗼𝗽𝗲 first');
});

test('the panel is reachable by keyboard and closes with Escape', async ({ page }) => {
  await page.goto('/review?post=SYN-L008');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page).not.toHaveURL(/post=/);
});

test('a viewer sees the panel without actions', async ({ page }) => {
  await signInAs(page.request, 'viewer');
  await page.goto('/review?post=SYN-L001');
  const panel = page.getByRole('dialog');
  await expect(panel.getByText('Read-only access.')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Approve and queue' })).toHaveCount(0);
});

test('ZHTW-04: the Threads version is updated inside the slot panel, no extra page', async ({ page }) => {
  await page.goto('/schedule?week=2026-10-01&slot=2026-10-02-MAIN-X');
  const panel = page.getByRole('dialog');
  await expect(panel.getByRole('heading', { name: 'Threads version (zh-TW)' })).toBeVisible();
  await expect(panel.getByText(/X copy changed after/i).first()).toBeVisible();
  await expect(page).toHaveURL(/slot=2026-10-02-MAIN-X/);
});
