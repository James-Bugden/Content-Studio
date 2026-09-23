import { expect, test } from '@playwright/test';

/**
 * T2 synthetic screenshots for handoff evidence. Written outside the repo only
 * when CS_SHOT_DIR is set; otherwise the test just asserts the pages render.
 */
const DIR = process.env.CS_SHOT_DIR;
const PAGES = ['/review', '/review/SYN-L008', '/ready', '/visuals', '/schedule', '/schedule/2026-10-02-MAIN-X', '/schedule/2026-10-02-MAIN-LI', '/published', '/published/2026-10-01-MAIN-X', '/reconcile'];

test('synthetic screens render without horizontal overflow', async ({ page }, info) => {
  await page.request.post('/api/test-control', { data: { kind: 'reset' } });
  await page.request.post('/api/test-auth', { data: { as: 'owner' } });
  for (const path of PAGES) {
    const res = await page.goto(path);
    if (!res || res.status() === 404) continue;
    await page.waitForLoadState('load');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${path} overflows`).toBeLessThanOrEqual(0);
    if (DIR) await page.screenshot({ path: `${DIR}/${info.project.name}${path.replace(/\//g, '_')}.png`, fullPage: true });
  }
});
