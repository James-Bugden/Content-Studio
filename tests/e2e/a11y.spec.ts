import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * T2 (synthetic) accessibility sweep: every studio page has no serious or
 * critical axe violations at the configured widths (UX-01, QA-03 emulated only).
 */
const PAGES = [
  '/',
  '/review',
  '/review?layout=cards',
  '/review/SYN-L008',
  '/visuals',
  '/visuals/SYN-L012',
  '/ready',
  '/ready/SYN-L005/promote?slot=2026-10-01-MAIN-LI',
  '/schedule?week=2026-10-01',
  '/schedule/2026-10-02-MAIN-X/adapt',
  '/reconcile',
  '/login',
];

test.beforeEach(async ({ page }) => {
  expect((await page.request.post('/api/test-control', { data: { kind: 'reset' } })).status()).toBe(200);
  expect((await page.request.post('/api/test-auth', { data: { as: 'owner' } })).status()).toBe(200);
});

for (const path of PAGES) {
  test(`UX-01: ${path} has no serious or critical axe violations`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState('load');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`)).toEqual([]);
  });
}
