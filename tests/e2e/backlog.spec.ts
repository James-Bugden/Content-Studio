import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

/**
 * Backlog (Content Queue idea-stage rows), spreadsheet-style. Grouped by
 * source, each group a dense table with the hook edited in place and Approve /
 * Skip done in place; the row (or its Open link) opens the side panel via
 * `?queue=<Library ID>`. Every write goes through the same mutation envelope as
 * Review transitions. Runs against the synthetic fakes (2 sources, 5 ideas: see
 * src/fixtures/synthetic.ts syntheticQueueRows), at both 375 and 1280 px: the
 * wide table and the stacked phone list both carry `data-library-id`, so the
 * helpers below address whichever one is visible.
 */
async function signInAs(request: APIRequestContext, as: 'owner' | 'viewer') {
  expect((await request.post('/api/test-auth', { data: { as } })).status()).toBe(200);
}

function group(page: Page, source: string): Locator {
  return page.locator('details').filter({ hasText: source });
}

async function openGroup(page: Page, source: string): Promise<Locator> {
  const g = group(page, source);
  await g.locator('summary').click();
  return g;
}

/** The visible row (table row from md up, stacked list item below) for one idea. */
function row(g: Locator, libraryId: string): Locator {
  return g.locator(`[data-library-id="${libraryId}"]:visible`);
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
  // Scoped to the group heading, not the source also present as a Reference filter option.
  await expect(group(page, 'Synthetic Backlog Ideas').getByText('(3 ideas)')).toBeVisible();
  await expect(group(page, 'Synthetic Interview Prep').getByText('(2 ideas)')).toBeVisible();
  // Closed by default: rows are not visible until their group is opened.
  await expect(page.locator('[data-library-id="IDEA-BL-0001"]:visible')).toHaveCount(0);
});

test('an opened group is a numbered table: one row per idea with its Library ID, hook and actions', async ({ page }) => {
  await page.goto('/backlog');
  const g = await openGroup(page, 'Synthetic Backlog Ideas');
  await expect(g.locator('[data-library-id]:visible')).toHaveCount(3);
  const first = row(g, 'IDEA-BL-0001');
  await expect(first).toContainText('1');
  await expect(first).toContainText('IDEA-BL-0001');
  await expect(first.getByRole('button', { name: /^Edit hook for IDEA-BL-0001/ })).toContainText('Remote roles hide a second negotiation.');
  await expect(first.getByRole('button', { name: 'Approve' })).toBeVisible();
  await expect(first.getByRole('button', { name: 'Skip' })).toBeVisible();
  await expect(first.getByRole('link', { name: 'Open IDEA-BL-0001 in the panel' })).toBeVisible();
  // Third row is numbered 3.
  await expect(row(g, 'IDEA-BL-0003').locator(':scope > *').first()).toHaveText(/^3/);
});

test('the Open link opens the side panel via the queue param', async ({ page }) => {
  await page.goto('/backlog');
  const g = await openGroup(page, 'Synthetic Backlog Ideas');
  await row(g, 'IDEA-BL-0001').getByRole('link', { name: 'Open IDEA-BL-0001 in the panel' }).click();
  await expect(page).toHaveURL(/queue=IDEA-BL-0001/);
  const panel = page.getByRole('dialog');
  await expect(panel.getByRole('heading', { name: /Remote roles hide a second negotiation/i })).toBeVisible();
  await expect(panel.getByLabel('Hook')).toHaveValue('Remote roles hide a second negotiation.');
});

test('clicking the row itself (not a control) also opens the panel', async ({ page }) => {
  await page.goto('/backlog');
  const g = await openGroup(page, 'Synthetic Backlog Ideas');
  // The Library ID cell is plain text, so this click lands on the row, not on a control.
  await row(g, 'IDEA-BL-0002').getByText('IDEA-BL-0002', { exact: true }).click();
  await expect(page).toHaveURL(/queue=IDEA-BL-0002/);
  await expect(page.getByRole('dialog').getByLabel('Hook')).toHaveValue('A slow counteroffer is still a counteroffer.');
});

test('editing a hook in place: Enter saves, and the new hook survives a reload', async ({ page }) => {
  await page.goto('/backlog');
  const g = await openGroup(page, 'Synthetic Backlog Ideas');
  const r = row(g, 'IDEA-BL-0002');
  await r.getByRole('button', { name: /^Edit hook for IDEA-BL-0002/ }).click();
  const input = r.getByRole('textbox', { name: 'Hook for IDEA-BL-0002' });
  await expect(input).toHaveValue('A slow counteroffer is still a counteroffer.');
  await input.fill('A slow counteroffer is still a counteroffer, act on it.');
  await input.press('Enter');
  await expect(r.getByRole('status')).toHaveText('Saved');
  await expect(r.getByRole('button', { name: /^Edit hook for IDEA-BL-0002/ })).toContainText('A slow counteroffer is still a counteroffer, act on it.');
  // No panel was involved.
  await expect(page).not.toHaveURL(/queue=/);

  await page.reload();
  const again = await openGroup(page, 'Synthetic Backlog Ideas');
  await expect(row(again, 'IDEA-BL-0002')).toContainText('A slow counteroffer is still a counteroffer, act on it.');
});

test('a second in-place edit after the first still saves (the row keeps the new revision)', async ({ page }) => {
  await page.goto('/backlog');
  const g = await openGroup(page, 'Synthetic Interview Prep');
  const r = row(g, 'IDEA-BL-0005');
  for (const text of ['First edit.', 'Second edit.']) {
    await r.getByRole('button', { name: /^Edit hook for IDEA-BL-0005/ }).click();
    const input = r.getByRole('textbox', { name: 'Hook for IDEA-BL-0005' });
    await input.fill(text);
    await input.press('Enter');
    await expect(r.getByRole('status')).toHaveText('Saved');
  }
  await page.reload();
  await expect(row(await openGroup(page, 'Synthetic Interview Prep'), 'IDEA-BL-0005')).toContainText('Second edit.');
});

test('Platform, PESTO and Hook template save in sequence and survive a reload', async ({ page }) => {
  await page.goto('/backlog');
  const g = await openGroup(page, 'Synthetic Backlog Ideas');
  const r = row(g, 'IDEA-BL-0001');

  const platformWrite = page.waitForRequest((req) => req.url().includes('/api/backlog/edit') && req.method() === 'POST');
  await r.getByRole('combobox', { name: 'Platform for IDEA-BL-0001' }).selectOption('X');
  expect(((await platformWrite).postDataJSON() as { patch: Record<string, string> }).patch).toEqual({ platform: 'X' });
  await expect(r.getByRole('status')).toHaveText('Saved');

  const pestoWrite = page.waitForRequest((req) => req.url().includes('/api/backlog/edit') && req.method() === 'POST');
  await r.getByRole('button', { name: /^Edit pesto stage for IDEA-BL-0001/ }).click();
  const pesto = r.getByRole('textbox', { name: 'PESTO stage for IDEA-BL-0001' });
  await pesto.fill('Opinions');
  await pesto.press('Enter');
  expect(((await pestoWrite).postDataJSON() as { patch: Record<string, string> }).patch).toEqual({ pesto: 'Opinions' });
  await expect(r.locator('[data-text-cell="PESTO stage"] [role="status"]')).toHaveText('Saved');

  const templateWrite = page.waitForRequest((req) => req.url().includes('/api/backlog/edit') && req.method() === 'POST');
  await r.getByRole('button', { name: /^Edit hook template for IDEA-BL-0001/ }).click();
  const template = r.getByRole('textbox', { name: 'Hook template for IDEA-BL-0001' });
  await expect(template).toHaveAttribute('list', /.+/);
  await template.fill('Story #7 - The day X changed how I Y');
  await template.press('Enter');
  expect(((await templateWrite).postDataJSON() as { patch: Record<string, string> }).patch).toEqual({ hookTemplate: 'Story #7 - The day X changed how I Y' });
  await expect(r.locator('[data-text-cell="Hook template"] [role="status"]')).toHaveText('Saved');
  await expect(page).not.toHaveURL(/queue=/);

  await page.reload();
  const saved = row(await openGroup(page, 'Synthetic Backlog Ideas'), 'IDEA-BL-0001');
  await expect(saved.getByRole('combobox', { name: 'Platform for IDEA-BL-0001' })).toHaveValue('X');
  await expect(saved.getByRole('button', { name: /^Edit pesto stage for IDEA-BL-0001/ })).toContainText('Opinions');
  await expect(saved.getByRole('button', { name: /^Edit hook template for IDEA-BL-0001/ })).toContainText('Story #7 - The day X changed how I Y');
});

test('new PESTO values become suggestions for another row and Escape does not write', async ({ page }) => {
  await page.goto('/backlog');
  let g = await openGroup(page, 'Synthetic Backlog Ideas');
  const first = row(g, 'IDEA-BL-0001');
  await first.getByRole('button', { name: /^Edit pesto stage for IDEA-BL-0001/ }).click();
  const firstPesto = first.getByRole('textbox', { name: 'PESTO stage for IDEA-BL-0001' });
  await firstPesto.fill('Opinions');
  await firstPesto.press('Enter');
  await expect(first.locator('[data-text-cell="PESTO stage"] [role="status"]')).toHaveText('Saved');

  await page.reload();
  g = await openGroup(page, 'Synthetic Backlog Ideas');
  const second = row(g, 'IDEA-BL-0002');
  await second.getByRole('button', { name: /^Edit pesto stage for IDEA-BL-0002/ }).click();
  const secondPesto = second.getByRole('textbox', { name: 'PESTO stage for IDEA-BL-0002' });
  const listId = await secondPesto.getAttribute('list');
  expect(listId).toBeTruthy();
  await expect(page.locator(`datalist#${listId} option[value="Opinions"]`)).toHaveCount(1);

  let writes = 0;
  const countWrite = (req: { url(): string; method(): string }) => {
    if (req.url().includes('/api/backlog/edit') && req.method() === 'POST') writes += 1;
  };
  page.on('request', countWrite);
  await secondPesto.fill('Must not be saved');
  await secondPesto.press('Escape');
  await page.waitForTimeout(100);
  page.off('request', countWrite);
  expect(writes).toBe(0);
  await expect(second.getByRole('button', { name: /^Edit pesto stage for IDEA-BL-0002/ })).toContainText('No PESTO stage');
});

test('Escape reverts an in-progress hook edit without saving', async ({ page }) => {
  await page.goto('/backlog');
  const g = await openGroup(page, 'Synthetic Backlog Ideas');
  const r = row(g, 'IDEA-BL-0003');
  await r.getByRole('button', { name: /^Edit hook for IDEA-BL-0003/ }).click();
  const input = r.getByRole('textbox', { name: 'Hook for IDEA-BL-0003' });
  await input.fill('This must not be saved');
  await input.press('Escape');
  await expect(r.getByRole('button', { name: /^Edit hook for IDEA-BL-0003/ })).toContainText('Benefits are salary you forgot to count.');
  await expect(r.getByRole('status')).toHaveCount(0);

  await page.reload();
  const again = await openGroup(page, 'Synthetic Backlog Ideas');
  await expect(row(again, 'IDEA-BL-0003')).toContainText('Benefits are salary you forgot to count.');
  await expect(again.getByText('This must not be saved')).toHaveCount(0);
});

test('Approve writes the review status in place and the row reports it, no panel needed', async ({ page }) => {
  await page.goto('/backlog');
  const g = await openGroup(page, 'Synthetic Backlog Ideas');
  const r = row(g, 'IDEA-BL-0001');
  const write = page.waitForRequest((req) => req.url().includes('/api/backlog/edit') && req.method() === 'POST');
  await r.getByRole('button', { name: 'Approve' }).click();
  const body = (await write).postDataJSON() as { libraryId: string; patch: Record<string, string> };
  expect(body.libraryId).toBe('IDEA-BL-0001');
  expect(body.patch).toEqual({ reviewStatus: 'Approved' });
  await expect(r.locator('[data-decided="Approved"]')).toHaveText(/Approved/);
  await expect(r.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  await expect(r.getByRole('button', { name: 'Skip' })).toHaveCount(0);
  // Open is still offered for the full editor.
  await expect(r.getByRole('link', { name: 'Open IDEA-BL-0001 in the panel' })).toBeVisible();
  await expect(page).not.toHaveURL(/queue=/);
});

test('Skip writes the review status in place', async ({ page }) => {
  await page.goto('/backlog');
  const g = await openGroup(page, 'Synthetic Interview Prep');
  const r = row(g, 'IDEA-BL-0004');
  const write = page.waitForRequest((req) => req.url().includes('/api/backlog/edit') && req.method() === 'POST');
  await r.getByRole('button', { name: 'Skip' }).click();
  expect(((await write).postDataJSON() as { patch: Record<string, string> }).patch).toEqual({ reviewStatus: 'Skipped' });
  await expect(r.locator('[data-decided="Skipped"]')).toHaveText('Skipped');
});

test('editing the hook in the panel and saving updates the table row', async ({ page }) => {
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

  await page.reload();
  const g = await openGroup(page, 'Synthetic Backlog Ideas');
  await expect(row(g, 'IDEA-BL-0002')).toContainText('A slow counteroffer is still a counteroffer, act on it.');
});

test('a viewer sees Platform, PESTO, Hook template and Hook as plain text, with only Open actionable', async ({ page }) => {
  await signInAs(page.request, 'viewer');
  await page.goto('/backlog');
  const g = await openGroup(page, 'Synthetic Backlog Ideas');
  const r = row(g, 'IDEA-BL-0001');
  await expect(r).toContainText('LinkedIn');
  await expect(r).toContainText('No PESTO stage');
  await expect(r).toContainText('Contrarian #12 - Everyone says X, but Y');
  await expect(r).toContainText('Remote roles hide a second negotiation.');
  await expect(r.getByRole('button')).toHaveCount(0);
  await expect(r.getByRole('textbox')).toHaveCount(0);
  await expect(r.getByRole('combobox')).toHaveCount(0);
  await expect(r.getByRole('link', { name: 'Open IDEA-BL-0001 in the panel' })).toBeVisible();
});

test('a viewer cannot edit in the panel either: read-only with no Save button', async ({ page }) => {
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
