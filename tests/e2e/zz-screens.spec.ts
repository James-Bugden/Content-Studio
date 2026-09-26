import { expect, test } from '@playwright/test';

/**
 * T2 synthetic screenshots for handoff evidence (THEME-04). Written outside the repo only
 * when CS_SHOT_DIR is set; otherwise the test just asserts the pages render.
 */
const DIR = process.env.CS_SHOT_DIR;
const PAGES = ['/', '/replies', '/review', '/review?layout=cards', '/review?post=SYN-L012', '/schedule?week=2026-10-01&slot=2026-10-02-MAIN-X', '/review/SYN-L008', '/ready', '/visuals', '/schedule', '/schedule/2026-10-02-MAIN-X', '/schedule/2026-10-02-MAIN-LI', '/published', '/published/2026-10-01-MAIN-X', '/reconcile'];

test('synthetic screens render without horizontal overflow', async ({ page }, info) => {
  await page.request.post('/api/test-control', { data: { kind: 'reset' } });
  await page.request.post('/api/test-auth', { data: { as: 'owner' } });
  for (const path of PAGES) {
    const res = await page.goto(path);
    if (!res || res.status() === 404) continue;
    await page.waitForLoadState('load');
    if (path.includes('post=') || path.includes('slot=')) await page.locator('dialog[open] h2').first().waitFor();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${path} overflows`).toBeLessThanOrEqual(0);
    if (DIR && (process.env.CS_SHOT_REPLIES_ONLY !== '1' || path === '/replies')) {
      await page.screenshot({ path: `${DIR}/${info.project.name}${path.replace(/[/?&=]/g, '_')}.png`, fullPage: true });
      if (path === '/replies') {
        await page.getByRole('button', { name: 'Get reply ideas' }).scrollIntoViewIfNeeded();
        // Move the action above the sticky strip; being inside the viewport
        // alone does not mean it is visually exposed on a phone.
        if (info.project.name === 'w375') await page.evaluate(() => window.scrollBy(0, 180));
        await page.screenshot({ path: `${DIR}/${info.project.name}_replies-action.png` });
      }
    }
  }
});
