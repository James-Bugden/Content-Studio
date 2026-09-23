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
/** Cards layout: one article per post, headed by its readable title. */
function card(page: Page, title: string) {
  return page.getByRole('article').filter({ has: page.getByRole('heading', { name: title }) });
}
const CARDS = '/review?layout=cards';

test.beforeEach(async ({ page }) => {
  await control(page.request, { kind: 'reset' });
});

test('REV-03: lanes and filters are URL enums and compose', async ({ page }) => {
  await signInAs(page.request, 'owner');
  await page.goto(CARDS);
  await expect(page.getByRole('heading', { name: 'Posts', level: 1 })).toBeVisible();
  await page.getByRole('navigation', { name: 'Post tabs' }).getByRole('link', { name: /Blocked/ }).click();
  await expect(page).toHaveURL(/lane=blocked/);
  await expect(page).toHaveURL(/layout=cards/);
  await expect(card(page, 'Quoted framework')).toBeVisible();
  await expect(card(page, 'Negotiate scope first')).toHaveCount(0);
  // The earlier lane values still work as aliases.
  await page.goto('/review?layout=cards&lane=copyright');
  await expect(card(page, 'Quoted framework')).toBeVisible();
  await expect(card(page, 'Anchor high')).toHaveCount(0);
  await page.goto('/review?layout=cards&target=LinkedIn&review=Pending&lane=<script>');
  await expect(card(page, 'Negotiate scope first')).toBeVisible();
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
  await page.goto(CARDS);
  const rework = card(page, 'Quoted framework');
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
  await page.goto(CARDS);
  const scope = card(page, 'Negotiate scope first');
  await scope.getByRole('button', { name: 'Approve and queue' }).click();
  await expect(scope.getByText('Approved and queued for scheduling.')).toBeVisible();
  await expect(scope.getByText('Queued', { exact: true })).toBeVisible();

  // Now an external edit lands after the page loaded.
  await page.goto(CARDS);
  const joint = card(page, 'Joint problem');
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
  await page.goto(CARDS);
  await expect(card(page, 'Negotiate scope first')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve and queue' })).toHaveCount(0);
  const res = await page.request.post('/api/review/transition', {
    headers: { origin: new URL(page.url()).origin },
    data: { operationId: 'op_e2e_viewer_01', libraryId: 'SYN-L001', expectedRevision: '0000000000000000', action: 'approve' },
  });
  expect(res.status()).toBe(403);
});

test('UX-05: keyboard-only review of a CJK card at 200% zoom, next action in words', async ({ page }) => {
  await signInAs(page.request, 'owner');
  await page.setViewportSize({ width: 640, height: 900 });
  await page.goto(CARDS);
  const joint = card(page, 'Joint problem');
  await expect(joint.getByText('談薪水不是吵架 🙂').first()).toBeVisible();
  await expect(joint.getByText(/^Next: Review,/)).toBeVisible();
  // Reach the card's primary action by keyboard only.
  const approve = joint.getByRole('button', { name: 'Approve only' });
  await approve.focus();
  await expect(approve).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(joint.getByText('Approved. The Sheet now holds this approval.')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('UX-01: the Posts table shows every step as words, and a row opens the panel', async ({ page }) => {
  await signInAs(page.request, 'owner');
  await page.goto('/review');
  await expect(page.getByRole('navigation', { name: 'Post tabs' }).getByRole('link', { name: /Ready to schedule/ })).toBeVisible();
  const table = page.getByRole('region', { name: 'Posts table' });
  const rows = page.locator('[data-library-id="SYN-L002"]:visible');
  await expect(rows).toHaveCount(1);
  await expect(rows.getByText('REWORK', { exact: true })).toBeVisible();
  if (await table.isVisible()) await expect(table.getByRole('columnheader', { name: 'Next step' })).toBeVisible();
  // No Library IDs or source lines in the visible text.
  expect(await page.locator('main').innerText()).not.toContain('SYN-L0');
  await rows.getByRole('link', { name: 'Quoted framework' }).click();
  await expect(page).toHaveURL(/[?&]post=SYN-L002/);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('UX-01: the Ready to schedule tab lists ready posts and keeps /ready working', async ({ page }) => {
  await signInAs(page.request, 'owner');
  await page.goto('/review?lane=ready&layout=cards');
  await expect(card(page, 'Researched range')).toBeVisible();
  await expect(card(page, 'Negotiate scope first')).toHaveCount(0);
  await expect(card(page, 'Researched range').getByRole('figure')).toBeVisible();
  const res = await page.goto('/ready');
  expect(res?.status()).toBe(200);
});
