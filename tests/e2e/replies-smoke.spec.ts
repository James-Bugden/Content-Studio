import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  expect(
    (await page.request.post('/api/test-auth', { data: { as: 'owner' } })).status(),
  ).toBe(200);
});

/**
 * Foundation smoke. The real journeys live in `reply-journey.spec.ts`; this file
 * checks the two things that are true before any feature works: the production
 * build serves, and a private response is never cacheable.
 */

test('the production build serves the app and a private health endpoint', async ({ page, request }) => {
  const health = await request.get('/api/health');
  expect(health.status()).toBe(200);
  expect(health.headers()['cache-control']).toContain('no-store');
  expect(await health.json()).toMatchObject({ ok: true, mode: 'fake' });

  await page.goto('/replies');
  await expect(page.getByRole('link', { name: 'Replies', exact: true })).toBeVisible();
});

test('the narrow workspace width does not scroll horizontally', async ({ page }) => {
  await page.setViewportSize({ width: 500, height: 800 });
  await page.goto('/replies');

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
