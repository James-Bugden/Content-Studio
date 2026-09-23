import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * App shell and shared states (CS-006: UX-01, UX-02, UX-03, UX-04).
 *
 * Runs against the synthetic states gallery only. Workflow routes become
 * auth-protected by the proxy, so they are covered by their own journeys.
 * Emulated widths and zoom are layout evidence, not physical-device evidence.
 */
const GALLERY = '/dev/states';

async function expectNoPageOverflow(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth, `page scrollWidth ${scrollWidth} exceeds viewport ${innerWidth}`).toBeLessThanOrEqual(innerWidth);
}

async function seriousAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 5) }));
}

test('gallery has no serious or critical axe violations', async ({ page }) => {
  await page.goto(GALLERY);
  await expect(page.getByRole('heading', { level: 1, name: 'States gallery' })).toBeVisible();
  expect(await seriousAxeViolations(page)).toEqual([]);
});

test('gallery has no serious axe violations with the conflict dialog open', async ({ page }) => {
  await page.goto(GALLERY);
  await page.getByRole('button', { name: 'Open conflict with a base' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await seriousAxeViolations(page)).toEqual([]);
});

test('skip link is the first Tab stop and moves focus to main', async ({ page }) => {
  await page.goto(GALLERY);
  await page.keyboard.press('Tab');
  const first = page.locator(':focus');
  await expect(first).toHaveText('Skip to main content');
  await expect(first).toBeVisible();
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('main');
});

test('landmarks and primary navigation are labelled and keyboard reachable', async ({ page }) => {
  await page.goto(GALLERY);
  await expect(page.getByRole('banner')).toHaveCount(1);
  await expect(page.getByRole('main')).toHaveCount(1);
  const nav = page.getByRole('navigation', { name: 'Primary' });
  await expect(nav.getByRole('link')).toHaveText(['Next up', 'Posts', 'Calendar', 'Published', 'Fix issues']);
  // Tab past the skip link lands on the first nav item.
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toHaveText('Next up');
});

for (const width of [375, 500, 750, 1280]) {
  test(`no horizontal page overflow at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(GALLERY);
    await expectNoPageOverflow(page);
    // Controls next to long English and CJK stay visible.
    await expect(page.getByRole('button', { name: 'Action stays visible' })).toBeInViewport({ ratio: 1 });
  });
}

test('no horizontal page overflow at 1280 px with 200% zoom (640 px viewport, DPR 2)', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 640, height: 450 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  try {
    await page.goto(GALLERY);
    await expectNoPageOverflow(page);
  } finally {
    await context.close();
  }
});

test('conflict dialog fits at 375 px, Escape closes it and focus returns', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(GALLERY);
  const opener = page.getByRole('button', { name: 'Open conflict with a base' });
  await opener.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: /Proposed/ })).toBeVisible();
  await expectNoPageOverflow(page);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test('navigating away from a dirty editor asks first and staying keeps the edit (UX-04)', async ({ page }) => {
  await page.goto(GALLERY);
  const editor = page.getByLabel('Draft (synthetic)');
  await editor.fill('A synthetic unsaved edit');
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Calendar' }).click();
  const dialog = page.getByRole('dialog', { name: 'Leave without saving?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Stay and keep editing' }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`${GALLERY}$`));
  await expect(editor).toHaveValue('A synthetic unsaved edit');
});

test('filters only write listed values to the URL', async ({ page }) => {
  await page.goto(`${GALLERY}?platform=not-a-real-value&item=LIB-0001`);
  await expect(page.getByLabel('Target platform')).toHaveValue('');
  await page.getByLabel('Gate status').selectOption('blocked');
  await expect(page).toHaveURL(/status=blocked/);
  const url = new URL(page.url());
  expect(url.searchParams.get('platform')).toBeNull();
  expect(url.searchParams.get('item')).toBe('LIB-0001');
});
