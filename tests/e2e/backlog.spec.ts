import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Backlog (Content Queue idea-stage rows), UX redesign. Grouped by source,
 * opened into the side panel via `?queue=<Library ID>`, edited through the
 * same mutation envelope as Review transitions. Runs against the synthetic
 * fakes (2 sources, 5 ideas: see src/fixtures/synthetic.ts syntheticQueueRows).
 */
async function signInAs(request: APIRequestContext, as: 'owner' | 'viewer') {
  expect((await request.post('/api/test-auth', { data: { as } })).status()).toBe(200);
}

test.beforeEach(async ({ page }) => {
  expect((await page.request.post('/api/test-control', { data: { kind: 'reset' } })).status()).toBe(200);
  await signInAs(page.request, 'owner');
});

test('the Backlog nav link is visible and opens the Backlog page', async ({ page }) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Primary' });
  const link = nav.getByRole('link', { name: 'Backlog' });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/backlog$/);
  await expect(page.getByRole('heading', { name: 'Backlog', level: 1 })).toBeVisible();
});

test('the page shows the 2 synthetic source groups, closed by default, with idea counts', async ({ page }) => {
  await page.goto('/backlog');
  await expect(page.getByText('Synthetic Backlog Ideas')).toBeVisible();
  await expect(page.getByText('(3 ideas)')).toBeVisible();
  await expect(page.getByText('Synthetic Interview Prep')).toBeVisible();
  await expect(page.getByText('(2 ideas)')).toBeVisible();
  // Closed by default: item rows are not visible until their group is opened.
  await expect(page.getByText('Remote roles hide a second negotiation.')).not.toBeVisible();
});

test('opening a group and clicking Start drafting opens the panel via the queue param', async ({ page }) => {
  await page.goto('/backlog');
  const group = page.locator('details').filter({ hasText: 'Synthetic Backlog Ideas' });
  await group.locator('summary').click();
  const row = group.getByRole('listitem').filter({ hasText: 'Remote roles hide a second negotiation.' });
  await expect(row).toBeVisible();
  await row.getByRole('link', { name: 'Start drafting' }).click();
  await expect(page).toHaveURL(/queue=IDEA-BL-0001/);
  const panel = page.getByRole('dialog');
  await expect(panel.getByRole('heading', { name: /Remote roles hide a second negotiation/i })).toBeVisible();
  await expect(panel.getByLabel('Hook')).toHaveValue('Remote roles hide a second negotiation.');
});

test('editing the hook and saving updates it', async ({ page }) => {
  await page.goto('/backlog?queue=IDEA-BL-0002');
  const panel = page.getByRole('dialog');
  const hook = panel.getByLabel('Hook');
  await expect(hook).toHaveValue('A slow counteroffer is still a counteroffer.');
  await hook.fill('A slow counteroffer is still a counteroffer, act on it.');
  const save = panel.getByRole('button', { name: 'Save' });
  await expect(save).toBeEnabled();
  await save.click();
  await expect(panel.getByText('Saved.')).toBeVisible();
  await panel.getByRole('button', { name: 'Close' }).click();
  await expect(page).not.toHaveURL(/queue=/);

  // The updated hook shows in the list without a full reload.
  await page.reload();
  const group = page.locator('details').filter({ hasText: 'Synthetic Backlog Ideas' });
  await group.locator('summary').click();
  await expect(group.getByText('A slow counteroffer is still a counteroffer, act on it.')).toBeVisible();
});

test('a viewer cannot edit: the panel is read-only with no Save button', async ({ page }) => {
  await signInAs(page.request, 'viewer');
  await page.goto('/backlog?queue=IDEA-BL-0003');
  const panel = page.getByRole('dialog');
  await expect(panel.getByText('Read-only access.')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Save' })).toHaveCount(0);
  await expect(panel.getByLabel('Hook')).not.toBeEditable();
});

test('closing the panel with an unsaved edit asks first and staying keeps the edit (UX-04)', async ({ page }) => {
  await page.goto('/backlog?queue=IDEA-BL-0004');
  const panel = page.getByRole('dialog').first();
  const hook = panel.getByLabel('Hook');
  await expect(hook).toHaveValue(/./);
  await hook.fill('An unsaved backlog edit');
  await panel.getByRole('button', { name: 'Close' }).click();
  const confirm = page.getByRole('dialog', { name: 'Leave without saving?' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Stay and keep editing' }).click();
  await expect(confirm).toBeHidden();
  await expect(page).toHaveURL(/queue=IDEA-BL-0004/);
  await expect(hook).toHaveValue('An unsaved backlog edit');
});
