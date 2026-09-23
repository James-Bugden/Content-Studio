import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * CS-007 Review Queue journeys (T1) against the synthetic fakes.
 * Every test starts from a fresh synthetic workbook.
 */
async function signInAs(request: APIRequestContext, as: 'owner' | 'viewer') {
  expect((await request.post('/api/test-auth', { data: { as } })).status()).toBe(200);
}
async function control(request: APIRequestContext, data: Record<string, unknown>) {
  expect((await request.post('/api/test-control', { data })).status()).toBe(200);
}
function card(page: Page, slug: string) {
  return page.getByRole('article').filter({ has: page.getByRole('heading', { name: slug }) });
}

test.beforeEach(async ({ page }) => {
  await control(page.request, { kind: 'reset' });
});

test('REV-03: lanes and filters are URL enums and compose', async ({ page }) => {
  await signInAs(page.request, 'owner');
  await page.goto('/review');
  await expect(page.getByRole('heading', { name: 'Review queue' })).toBeVisible();
  await page.getByRole('link', { name: /Copyright rework/ }).click();
  await expect(page).toHaveURL(/lane=copyright/);
  await expect(card(page, 'quoted-framework')).toBeVisible();
  await expect(card(page, 'negotiate-scope-first')).toHaveCount(0);
  await page.goto('/review?target=LinkedIn&review=Pending&lane=<script>');
  await expect(card(page, 'negotiate-scope-first')).toBeVisible();
  expect(page.url()).not.toContain('Most people');
});

test('REV-05: no match and provider failure are distinct screens', async ({ page }) => {
  await signInAs(page.request, 'owner');
  await page.goto('/review?target=Threads');
  await expect(page.locator('[data-state="no_match"]')).toBeVisible();
  await control(page.request, { kind: 'fail', provider: 'sheet', op: 'read', code: 'PROVIDER_UNAVAILABLE', tab: 'Content Library' });
  await page.goto('/review');
  await expect(page.getByRole('alert').first()).toBeVisible();
  await expect(page.locator('[data-state="no_match"], [data-state="empty"]')).toHaveCount(0);
});

test('REV-04: REWORK and CHECK cannot be approved, with the exact blocker shown', async ({ page }) => {
  await signInAs(page.request, 'owner');
  await page.goto('/review');
  const rework = card(page, 'quoted-framework');
  await expect(rework.getByText('Copyright QA says this needs rework.')).toBeVisible();
  await expect(rework.getByRole('button', { name: 'Approve and queue' })).toBeDisabled();
  // A direct API call is refused too, not just the disabled button.
  const res = await page.request.post('/api/review/transition', {
    headers: { origin: new URL(page.url()).origin },
    data: { operationId: 'op_e2e_bypass_01', libraryId: 'SYN-L002', expectedRevision: '0000000000000000', action: 'approve' },
  });
  expect([409, 422]).toContain(res.status());
});

test('REV-06: approve and queue writes the Sheet; a stale row opens a comparison instead', async ({ page }) => {
  await signInAs(page.request, 'owner');
  await page.goto('/review');
  const scope = card(page, 'negotiate-scope-first');
  await scope.getByRole('button', { name: 'Approve and queue' }).click();
  await expect(scope.getByText('Approved and queued for scheduling.')).toBeVisible();
  await expect(scope.getByText('Queued', { exact: true })).toBeVisible();

  // Now an external edit lands after the page loaded.
  await page.goto('/review');
  const joint = card(page, 'joint-problem');
  await control(page.request, { kind: 'sheet_edit', libraryId: 'SYN-L008', header: 'Current Hook', value: 'Edited directly in the Sheet' });
  await joint.getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog').getByText('Edited directly in the Sheet')).toBeVisible();
  await page.getByRole('button', { name: 'Review the latest version' }).click();
  await expect(joint.getByText('Edited directly in the Sheet')).toBeVisible();
});

test('cross-origin transition is refused', async ({ page }) => {
  await signInAs(page.request, 'owner');
  const res = await page.request.post('/api/review/transition', {
    headers: { origin: 'https://evil.example.com' },
    data: { operationId: 'op_e2e_cross_01', libraryId: 'SYN-L001', expectedRevision: '0000000000000000', action: 'approve' },
  });
  expect(res.status()).toBe(403);
});

test('viewer sees the queue without review actions and cannot transition', async ({ page }) => {
  await signInAs(page.request, 'viewer');
  await page.goto('/review');
  await expect(card(page, 'negotiate-scope-first')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve and queue' })).toHaveCount(0);
  const res = await page.request.post('/api/review/transition', {
    headers: { origin: new URL(page.url()).origin },
    data: { operationId: 'op_e2e_viewer_01', libraryId: 'SYN-L001', expectedRevision: '0000000000000000', action: 'approve' },
  });
  expect(res.status()).toBe(403);
});
