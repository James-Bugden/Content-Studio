import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * CS-012 Visual Studio journeys (T1) plus phone-width review evidence (T2)
 * against the synthetic fakes. Screenshots are written outside the repo only when
 * CS_SHOT_DIR is set.
 */
const DIR = process.env.CS_SHOT_DIR;

async function signInAs(request: APIRequestContext, as: 'owner' | 'viewer') {
  expect((await request.post('/api/test-auth', { data: { as } })).status()).toBe(200);
}
async function control(request: APIRequestContext, data: Record<string, unknown>) {
  expect((await request.post('/api/test-control', { data })).status()).toBe(200);
}
async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

test.beforeEach(async ({ page }) => {
  await control(page.request, { kind: 'reset' });
});

test('VIS-02/03/04: brief, render, phone review, exact approval, then stale after a brief edit', async ({ page }, info) => {
  await signInAs(page.request, 'owner');
  await page.goto('/visuals/SYN-L001');
  await expect(page.getByRole('heading', { name: 'negotiate-scope-first' })).toBeVisible();
  await expect(page.getByText('English', { exact: true })).toBeVisible();

  await page.getByRole('radio', { name: /Original graphic/ }).check();
  await page.getByRole('button', { name: 'Save decision' }).click();
  await expect(page.getByRole('heading', { name: '2. Brief' })).toBeVisible();

  // The ASCII plan comes first in the form.
  const firstField = page.locator('#brief-h ~ form textarea, #brief-h ~ form input').first();
  await expect(firstField).toHaveAttribute('id', 'f-ascii');

  await page.getByLabel('ASCII plan').fill('[ one number ]  vs  [ researched range ]\n   weak                 strong');
  await page.getByLabel('Lesson').fill('Anchor with a researched range, not a single number');
  await page.getByLabel('Grammar').selectOption('contrast');
  await page.getByLabel('Main idea 1').fill('A single number invites a counter');
  await expect(page.getByText(/Use 2 to 4 main ideas \(1 now\)/)).toBeVisible();
  await page.getByLabel('Main idea 2').fill('A range shows research');
  await page.getByLabel('Main idea 3').fill('Lead with the top of the range');
  await page.getByLabel('Exact line-broken copy').fill('One number invites a counter.\nA researched range\nshows you did the work.');
  await page.getByLabel('Focal phrase').fill('researched range');
  await page.getByLabel('Alt text').fill('Two boxes compare a single salary number with a researched salary range.');
  await expect(page.getByText('The brief is complete and fits the layout.')).toBeVisible();

  // Rendering waits for a saved brief.
  await expect(page.getByRole('button', { name: 'Render new revision' })).toBeDisabled();
  await page.getByRole('button', { name: 'Save brief' }).click();
  await expect(page.getByText('Brief saved and ready to render.')).toBeVisible();

  await page.getByRole('button', { name: 'Render new revision' }).click();
  await expect(page.getByText(/Rendered SOAR-v1\.1 \/ r01 \/ LinkedIn \/ en\./)).toBeVisible();
  await expect(page.getByTestId('version-label')).toHaveText('SOAR-v1.1 / r01 / LinkedIn / en');

  // Full size plus 360 and 390 px phone previews, all loaded from the server render route.
  for (const w of [360, 390]) {
    const img = page.locator(`[data-phone-width="${w}"] img`);
    await img.scrollIntoViewIfNeeded();
    await expect(img).toBeVisible();
    await expect.poll(async () => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBe(1080);
    expect(Math.round((await img.boundingBox())!.width)).toBe(w);
  }
  await noHorizontalOverflow(page);
  if (DIR) {
    await page.locator('[aria-labelledby="review-h"]').screenshot({ path: `${DIR}/cs012-review-${info.project.name}.png` });
    await page.screenshot({ path: `${DIR}/cs012-visual-editor-${info.project.name}.png`, fullPage: true });
  }

  // The rendered SVG itself, at full size, for the handoff (w1280 only).
  if (DIR && info.project.name === 'w1280') {
    const shot = await page.context().newPage();
    await shot.setViewportSize({ width: 1080, height: 1080 });
    await shot.goto('/api/library/SYN-L001/render?rev=current');
    await shot.screenshot({ path: `${DIR}/cs012-render-SYN-L001-r01.png` });
    await shot.close();
  }

  await page.getByRole('button', { name: 'Approve this exact revision' }).click();
  await expect(page.getByText('Approved SOAR-v1.1 / r01 / LinkedIn / en for LinkedIn.').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve this exact revision' })).toBeDisabled();

  // Any later brief change makes the approval stale, visibly.
  await page.getByLabel('Exact line-broken copy').fill('One number invites a counter.\nA researched range\nproves you did the work.');
  await page.getByRole('button', { name: 'Save brief' }).click();
  await expect(page.getByTestId('stale-banner')).toContainText('Approval is stale');
  await expect(page.getByRole('button', { name: 'Approve this exact revision' })).toBeDisabled();
  await expect(page.locator('[data-gate-code="VISUAL_STALE"]').first()).toBeVisible();
  // r01 is no longer shown: a re-render of the edited brief under the r01 label would mislead.
  await expect(page.getByTestId('preview-changed')).toBeVisible();
  await expect(page.locator('[data-phone-width]')).toHaveCount(0);
  expect((await page.request.get('/api/library/SYN-L001/render?rev=current')).status()).toBe(409);
  if (DIR) await page.screenshot({ path: `${DIR}/cs012-stale-${info.project.name}.png`, fullPage: true });

  // A new revision brings the previews back, labelled r02.
  await page.getByRole('button', { name: 'Render new revision' }).click();
  await expect(page.getByTestId('version-label')).toHaveText('SOAR-v1.1 / r02 / LinkedIn / en');
  await expect(page.locator('[data-phone-width]')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Approve this exact revision' })).toBeEnabled();
});

test('VIS-05: SYN-L009 screenshot reuse on the same platform is blocked with a reason', async ({ page }, info) => {
  await signInAs(page.request, 'owner');
  await page.goto('/visuals/SYN-L009');
  await expect(page.getByText(/This screenshot is already used on LinkedIn/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve this exact revision' })).toBeDisabled();
  await expect(page.locator('[data-gate-code="SCREENSHOT_REUSED"]').first()).toBeVisible();

  // The same id typed for another LinkedIn item is refused before anything is written.
  await page.goto('/visuals/SYN-L001');
  await page.getByRole('radio', { name: /Screenshot/ }).check();
  await page.getByRole('textbox', { name: 'Screenshot id' }).fill('SHOT-2026-014');
  await page.getByRole('button', { name: 'Check reuse' }).click();
  await expect(page.getByText(/Reuse check: This screenshot is already used on LinkedIn/)).toBeVisible();
  await page.getByRole('button', { name: 'Save decision' }).click();
  await expect(page.getByText(/Not done: This screenshot is already used on LinkedIn/)).toBeVisible();
  await noHorizontalOverflow(page);

  await page.goto('/visuals');
  await expect(page.getByRole('heading', { name: 'Visual studio' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'offer-email-teardown' })).toBeVisible();
  await noHorizontalOverflow(page);
  if (DIR) await page.screenshot({ path: `${DIR}/cs012-visuals-list-${info.project.name}.png`, fullPage: true });
});

test('viewers see the review but no actions', async ({ page }) => {
  await signInAs(page.request, 'viewer');
  await page.goto('/visuals/SYN-L012');
  await expect(page.getByTestId('version-label')).toHaveText('SOAR-v1.1 / r02 / LinkedIn / en');
  await expect(page.getByRole('button', { name: 'Approve this exact revision' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save decision' })).toHaveCount(0);
});
