import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * CS-013 / CS-014 journeys (T1): Ready Queue, promotion preview and confirm,
 * schedule week view, bypass attempts and a browser in another timezone.
 * The e2e server pins Taipei "today" to 2026-09-30 (CS_FAKE_TODAY).
 *
 * The calendar renders the week grid (>= 768 px) and the day list (phones) and
 * hides one with CSS, so slot cards are found by `data-content-id` among the
 * visible elements; both layouts run at w375 and w1280.
 */
async function signInAs(request: APIRequestContext, as: 'owner' | 'viewer') {
  expect((await request.post('/api/test-auth', { data: { as } })).status()).toBe(200);
}

const visibleCard = (page: Page, contentId: string) => page.locator(`[data-content-id="${contentId}"]`).filter({ visible: true });
const visibleDay = (page: Page, isoDate: string) => page.locator(`[data-date="${isoDate}"]`).filter({ visible: true });

test.beforeEach(async ({ page }) => {
  expect((await page.request.post('/api/test-control', { data: { kind: 'reset' } })).status()).toBe(200);
  await signInAs(page.request, 'owner');
});

test('READY-03 / READY-04 / READY-06: groups are recomputed from Content Library', async ({ page }) => {
  await page.goto('/ready');
  const ready = page.getByRole('region', { name: /Ready to schedule/ });
  await expect(ready.getByRole('heading', { name: 'counteroffer-is-information' })).toBeVisible();
  await expect(ready.getByRole('heading', { name: 'silence-after-offer' })).toBeVisible();
  await expect(page.getByText(/Threads zh-TW adaptation must be made/)).toBeVisible();
  const blocked = page.getByRole('region', { name: /^Blocked/ });
  await expect(blocked.getByRole('heading', { name: 'walk-away-number' })).toBeVisible();
  await expect(blocked.getByText('The copy, hook or visual changed after approval.')).toBeVisible();
});

test('SCHED-02: preview lists every written cell, confirm writes into the slot', async ({ page }) => {
  await page.goto('/ready');
  await page.getByRole('article').filter({ hasText: 'counteroffer-is-information' }).getByRole('link', { name: 'Preview promotion' }).click();
  await page.getByRole('link', { name: /2026-10-01 · Main · 21:00/ }).click();
  const table = page.getByRole('table');
  await expect(table.getByRole('rowheader', { name: 'Hook', exact: true })).toBeVisible();
  await expect(table.getByRole('rowheader', { name: 'Source MD / Drive Link' })).toBeVisible();
  await expect(table.getByRole('rowheader', { name: 'Content ID' })).toHaveCount(0);
  await page.getByRole('button', { name: /Confirm and write to 2026-10-01-MAIN-LI/ }).click();
  await expect(page.getByText(/Scheduled into 2026-10-01-MAIN-LI/)).toBeVisible();

  await page.goto('/schedule?week=2026-10-01');
  const card = visibleDay(page, '2026-10-01').locator('[data-content-id="2026-10-01-MAIN-LI"]');
  await expect(card.getByText('A counteroffer is information, not an insult.')).toBeVisible();

  await page.goto('/ready');
  await expect(page.getByRole('region', { name: /Already scheduled/ }).getByRole('heading', { name: 'counteroffer-is-information' })).toBeVisible();
});

test('SCHED-03: a double confirm fills one slot only', async ({ page }) => {
  await page.goto('/ready/SYN-L005/promote?slot=2026-10-01-MAIN-LI');
  await page.getByRole('button', { name: /Confirm and write/ }).dblclick();
  await expect(page.getByText(/Scheduled into 2026-10-01-MAIN-LI/)).toBeVisible();
  await page.goto('/schedule?week=2026-10-01');
  await expect(page.locator('[data-content-id]').filter({ visible: true, hasText: 'A counteroffer is information, not an insult.' })).toHaveCount(1);
  await page.goto('/ready/SYN-L005/promote');
  await expect(page.getByText('Already scheduled').first()).toBeVisible();
});

test('SCHED-05 / READY-07: direct API promotion of an unapproved item is refused', async ({ page }) => {
  await page.goto('/ready');
  const res = await page.request.post('/api/schedule/promote', {
    headers: { origin: new URL(page.url()).origin },
    data: { operationId: 'op_e2e_bypass_promote', libraryId: 'SYN-L001', contentId: '2026-10-01-MAIN-LI', expectedLibraryRevision: '0000000000000000', expectedScheduleRevision: '0000000000000000' },
  });
  expect([409, 422]).toContain(res.status());
  const direct = await page.request.post('/api/schedule/promote', {
    headers: { origin: new URL(page.url()).origin },
    data: { operationId: 'op_e2e_bypass_promote2', libraryId: 'NOT-A-LIBRARY-ID', contentId: '2026-10-01-MAIN-LI', expectedLibraryRevision: '0000000000000000', expectedScheduleRevision: '0000000000000000' },
  });
  expect(direct.status()).toBe(404);
});

test('viewer cannot open the promotion page or call the API', async ({ page }) => {
  await signInAs(page.request, 'viewer');
  await page.goto('/ready/SYN-L005/promote');
  await expect(page.getByRole('alert').first()).toBeVisible();
  const res = await page.request.post('/api/schedule/promote', {
    headers: { origin: new URL(page.url()).origin },
    data: { operationId: 'op_e2e_viewer_promote', libraryId: 'SYN-L005', contentId: '2026-10-01-MAIN-LI', expectedLibraryRevision: '0000000000000000', expectedScheduleRevision: '0000000000000000' },
  });
  expect(res.status()).toBe(403);
});

test.describe('in a browser in Los Angeles', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });
  test('UX-07: days and times are Taipei, status is text not colour', async ({ page }) => {
    await page.goto('/schedule?week=2026-10-01');
    // The 08:00 Taipei post sits on Thursday 1 October (it is Wednesday afternoon in LA).
    const card = visibleDay(page, '2026-10-01').locator('[data-content-id="2026-10-01-MAIN-X"]');
    await expect(card.getByText('08:00')).toBeVisible();
    await expect(card.getByText('✓ Published')).toBeVisible();
    await expect(visibleDay(page, '2026-09-30').locator('[data-content-id="2026-10-01-MAIN-X"]')).toHaveCount(0);
    // A stale Threads adaptation is a next step in words with a "!" marker, not a colour.
    await expect(visibleCard(page, '2026-10-02-MAIN-X')).toContainText('! Update Chinese');
  });
});

test('CS-017: the reconciliation centre lists stale items with their next step', async ({ page }) => {
  await page.goto('/reconcile');
  await expect(page.getByRole('heading', { name: 'SYN-L006: approval no longer matches the copy' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '2026-10-02-MAIN-X: Threads adaptation is out of date' })).toBeVisible();
  const item = page.getByRole('article').filter({ hasText: 'SYN-L006: approval no longer matches' });
  await item.getByRole('button', { name: 'Dismiss as reviewed' }).click();
  await expect(page.getByRole('heading', { name: 'SYN-L006: approval no longer matches the copy' })).toHaveCount(0);
  await expect(page.getByText(/reviewed item is hidden in this tab/)).toBeVisible();
});
