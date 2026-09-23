import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * CS-009 English QA, CS-010 hook review and CS-011 X to Threads zh-TW journeys (T1)
 * against the synthetic fakes and the deterministic fake AI.
 */
async function signInAs(request: APIRequestContext, as: 'owner' | 'viewer') {
  expect((await request.post('/api/test-auth', { data: { as } })).status()).toBe(200);
}
async function control(request: APIRequestContext, data: Record<string, unknown>) {
  expect((await request.post('/api/test-control', { data })).status()).toBe(200);
}
type EditorJson = { model: { sheet: { revision: string; draft: string; hook: string }; markdown: { body: string } } };
async function editorModel(page: Page): Promise<EditorJson['model']> {
  const res = await page.request.get('/api/library/SYN-L001/editor');
  expect(res.status()).toBe(200);
  return ((await res.json()) as EditorJson).model;
}
const editor = (page: Page) => page.getByLabel(/Post copy/);
const finding = (page: Page, original: string) =>
  page.locator('[data-finding]').filter({ has: page.locator('[data-role="original"]', { hasText: new RegExp(`^${original}$`) }) });
const alternatives = (page: Page) => page.locator('[data-hook-card]:not([data-hook-card="current"])');

const QA_TEXT = 'We organize the color of the offer.\n\nScope decides the salary band.';

test.beforeEach(async ({ page }) => {
  await control(page.request, { kind: 'reset' });
  await signInAs(page.request, 'owner');
});

test('ENQA-01/02: a British spelling finding applies only its range, and Save persists it', async ({ page }) => {
  await page.goto('/review/SYN-L001');
  await editor(page).fill(QA_TEXT);
  await page.getByRole('button', { name: 'Check English', exact: true }).click();
  const color = finding(page, 'color');
  await expect(color).toBeVisible();
  await expect(color.locator('[data-role="replacement"]')).toHaveText('colour');
  await expect(color).toContainText('Should fix');
  await expect(finding(page, 'organize')).toBeVisible();
  // Nothing changed until a finding is accepted.
  await expect(editor(page)).toHaveValue(QA_TEXT);
  await color.getByRole('button', { name: 'Accept' }).click();
  await expect(editor(page)).toHaveValue(QA_TEXT.replace('color', 'colour'));
  await expect(finding(page, 'color')).toHaveCount(0);
  // The other finding was re-bound to the new text and still applies.
  await finding(page, 'organize').getByRole('button', { name: 'Accept' }).click();
  await expect(editor(page)).toHaveValue('We organise the colour of the offer.\n\nScope decides the salary band.');
  // Accepting does not save; the normal Save flow does.
  expect((await editorModel(page)).markdown.body).not.toContain('colour');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Saved to the master Markdown and mirrored to the Sheet.')).toBeVisible();
  const model = await editorModel(page);
  expect(model.markdown.body).toBe('We organise the colour of the offer.\n\nScope decides the salary band.');
  expect(model.sheet.draft).toBe(model.markdown.body);
});

test('ENQA-03: typing after a check makes Accept refuse', async ({ page }) => {
  await page.goto('/review/SYN-L001');
  await editor(page).fill(QA_TEXT);
  await page.getByRole('button', { name: 'Check English', exact: true }).click();
  await expect(finding(page, 'color')).toBeVisible();
  await editor(page).press('End');
  await editor(page).pressSequentially(' More.');
  const typed = await editor(page).inputValue();
  await expect(page.getByText(/Out of date/)).toBeVisible();
  await finding(page, 'color').getByRole('button', { name: 'Accept' }).click();
  await expect(page.getByText('The draft changed since this check; run it again.').last()).toBeVisible();
  await expect(editor(page)).toHaveValue(typed);
});

test('AI-01: an AI failure shows an error and the draft stays editable and savable', async ({ page }) => {
  await page.goto('/review/SYN-L001');
  await control(page.request, { kind: 'ai_fail', code: 'PROVIDER_UNAVAILABLE' });
  await page.getByRole('button', { name: 'Check English', exact: true }).click();
  await expect(page.getByText('The English check did not finish')).toBeVisible();
  await expect(page.locator('[data-state="provider_error"]')).toBeVisible();
  await editor(page).fill('Still editable after the AI failed.');
  await expect(editor(page)).toHaveValue('Still editable after the AI failed.');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Saved to the master Markdown and mirrored to the Sheet.')).toBeVisible();
  // A malformed reply that cannot be repaired is also a typed failure, never a fake result.
  await control(page.request, { kind: 'ai_fail', malformed: 2 });
  await page.getByRole('button', { name: 'Suggest three hooks' }).click();
  await expect(page.getByText('Hook suggestions did not finish')).toBeVisible();
  await expect(alternatives(page)).toHaveCount(0);
});

test('HOOK-01/02/04: three scored alternatives with LinkedIn checks, and nothing is written', async ({ page }) => {
  const before = await editorModel(page);
  await page.goto('/review/SYN-L001');
  await page.getByRole('button', { name: 'Suggest three hooks' }).click();
  await expect(alternatives(page)).toHaveCount(3);
  for (let i = 0; i < 3; i += 1) {
    const card = alternatives(page).nth(i);
    const values = await card.locator('[data-score] [data-value]').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-value'))));
    expect(values).toHaveLength(5);
    const total = Number(await card.getAttribute('data-total'));
    expect(total).toBe(values.reduce((a, b) => a + b, 0));
    await expect(card.locator('[data-role="total"]')).toHaveText(`${total} of 10`);
    await expect(card.locator('[data-role="linkedin-checks"]')).toContainText('Audience: yes');
    await expect(card.locator('[data-role="linkedin-checks"]')).toContainText('Role or keyword: yes');
    await expect(card.locator('[data-role="linkedin-checks"]')).toContainText('Direct relevance: yes');
    await expect(card).toContainText('Framework:');
  }
  // The current hook is still there and still the selection.
  await expect(page.locator('[data-hook-card="current"]')).toContainText(before.sheet.hook);
  await expect(page.locator('[data-hook-card="current"] input[type="radio"]')).toBeChecked();
  await expect(page.getByRole('button', { name: 'Use this hook' })).toBeDisabled();
  const after = await editorModel(page);
  expect(after).toEqual(before);
});

test('HOOK-03: choosing an alternative updates the hook and the opening together', async ({ page }) => {
  await page.goto('/review/SYN-L001');
  await page.getByRole('button', { name: 'Suggest three hooks' }).click();
  await expect(alternatives(page)).toHaveCount(3);
  const chosen = (await alternatives(page).nth(1).locator('.copy').first().innerText()).trim();
  await alternatives(page).nth(1).getByRole('radio').check();
  await page.getByRole('button', { name: 'Use this hook' }).click();
  await expect(page.getByText('Hook updated: the Sheet hook fields and the opening of the draft were saved together.')).toBeVisible();
  const model = await editorModel(page);
  expect(model.sheet.hook).toBe(chosen);
  expect(model.markdown.body.startsWith(`${chosen}\n`)).toBe(true);
  expect(model.markdown.body.endsWith('Scope decides the salary band.')).toBe(true);
  expect(model.sheet.draft).toBe(model.markdown.body);
  await expect(editor(page)).toHaveValue(model.markdown.body);
  await expect(page.locator('[data-hook-card="current"]')).toContainText(chosen);
  // The reloaded editor holds the new revisions: an ordinary save still works.
  await editor(page).fill(`${model.markdown.body}\n\nOne more line.`);
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Saved to the master Markdown and mirrored to the Sheet.')).toBeVisible();
});

test('HOOK: choosing is refused while the draft has unsaved changes, and after it changed', async ({ page }) => {
  await page.goto('/review/SYN-L001');
  await page.getByRole('button', { name: 'Suggest three hooks' }).click();
  await expect(alternatives(page)).toHaveCount(3);
  await alternatives(page).nth(0).getByRole('radio').check();
  await editor(page).press('End');
  await editor(page).pressSequentially(' Edited.');
  await expect(page.getByText('The draft changed; generate again.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use this hook' })).toBeDisabled();
  await expect(page.getByText(/Save or undo your draft changes first/)).toBeVisible();
});

test('ZHTW-01/05: an eligible X row generates, saves for review and is approved explicitly', async ({ page }) => {
  await page.goto('/schedule/2026-10-03-MAIN-X/adapt');
  await expect(page.locator('[data-zh-state="missing"]')).toBeVisible();
  await expect(page.getByTestId('x-source')).toHaveText('Recruiters read the first line.\n\nMake it about the job seeker, not the salary.');
  await expect(page.getByRole('button', { name: 'Approve Chinese copy' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Generate adaptation' }).click();
  const hook = page.getByLabel(/Chinese hook/);
  await expect(hook).toHaveValue('招募人員會先看第一行。');
  await expect(hook).toHaveAttribute('lang', 'zh-Hant-TW');
  await expect(page.getByLabel(/Chinese content/)).toHaveValue('招募人員會先看第一行。\n\n重點放在求職者身上，而不是薪資。');
  await expect(page.locator('[data-qa]')).toHaveCount(5);
  await expect(page.locator('[data-qa="taiwanUsage"]')).toContainText('Pass');
  await expect(page.getByText(/job seeker -> 求職者/)).toBeVisible();
  // Generation wrote nothing.
  let state = (await (await page.request.get('/api/schedule/2026-10-03-MAIN-X/zh')).json()) as { view: { state: string } };
  expect(state.view.state).toBe('missing');
  await page.getByRole('button', { name: 'Save for Chinese review' }).click();
  await expect(page.locator('[data-zh-state="awaiting_review"]')).toBeVisible();
  await expect(page.getByTestId('saved-zh')).toHaveText('招募人員會先看第一行。\n\n重點放在求職者身上，而不是薪資。');
  await page.getByRole('button', { name: 'Approve Chinese copy' }).click();
  await expect(page.locator('[data-zh-state="approved"]')).toBeVisible();
  state = (await (await page.request.get('/api/schedule/2026-10-03-MAIN-X/zh')).json()) as { view: { state: string } };
  expect(state.view.state).toBe('approved');
});

test('ZHTW-04: a stale adaptation shows the banner and cannot be approved', async ({ page }) => {
  await page.goto('/schedule/2026-10-02-MAIN-X/adapt');
  await expect(page.getByTestId('stale-banner')).toContainText('The X copy changed after this translation.');
  await expect(page.locator('[data-zh-state="stale"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve Chinese copy' })).toHaveCount(0);
  await expect(page.getByText(/Approval is unavailable: the adaptation is stale/)).toBeVisible();
  const view = (await (await page.request.get('/api/schedule/2026-10-02-MAIN-X/zh')).json()) as { view: { threads: { contentId: string; revision: string } } };
  const res = await page.request.post('/api/schedule/2026-10-02-MAIN-X/zh/approve', {
    headers: { origin: new URL(page.url()).origin },
    data: { operationId: 'op_e2e_stale_approve', threadsContentId: view.view.threads.contentId, expectedRevision: view.view.threads.revision },
  });
  expect(res.status()).toBe(422);
});

test('ZHTW-01: a non-eligible X row lists its blockers and cannot generate', async ({ page }) => {
  await page.goto('/schedule/2026-10-01-2ND-X/adapt');
  await expect(page.getByText('This X post cannot be adapted yet')).toBeVisible();
  await expect(page.locator('[data-blocker="missing_hook"]')).toHaveText('The X hook is empty.');
  await expect(page.locator('[data-blocker="missing_content"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Generate adaptation' })).toBeDisabled();
  const res = await page.request.post('/api/schedule/2026-10-01-2ND-X/zh', { headers: { origin: new URL(page.url()).origin }, data: {} });
  expect(res.status()).toBe(422);
});

test('viewer sees the panels without actions, and the AI APIs refuse', async ({ page }) => {
  await signInAs(page.request, 'viewer');
  await page.goto('/review/SYN-L001');
  await expect(page.getByRole('heading', { name: 'English check' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Hook review' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check English' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Suggest three hooks' })).toHaveCount(0);
  const origin = new URL(page.url()).origin;
  const hash = '0000000000000000';
  expect((await page.request.post('/api/library/SYN-L001/qa', { headers: { origin }, data: { draft: 'x', draftHash: hash } })).status()).toBe(403);
  expect((await page.request.post('/api/library/SYN-L001/hooks', { headers: { origin }, data: { draft: 'x', draftHash: hash } })).status()).toBe(403);
  await page.goto('/schedule/2026-10-03-MAIN-X/adapt');
  await expect(page.locator('[data-zh-state="missing"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Generate adaptation' })).toHaveCount(0);
  expect((await page.request.post('/api/schedule/2026-10-03-MAIN-X/zh', { headers: { origin }, data: {} })).status()).toBe(403);
});

test('synthetic AI screens render without horizontal overflow', async ({ page }, info) => {
  const dir = process.env.CS_SHOT_DIR;
  await page.goto('/review/SYN-L001');
  await editor(page).fill(QA_TEXT);
  await page.getByRole('button', { name: 'Check English', exact: true }).click();
  await expect(finding(page, 'color')).toBeVisible();
  await page.getByRole('button', { name: 'Suggest three hooks' }).click();
  await expect(alternatives(page)).toHaveCount(3);
  let overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, 'editor overflows').toBeLessThanOrEqual(0);
  if (dir) await page.screenshot({ path: `${dir}/cs009_editor_ai_${info.project.name}.png`, fullPage: true });
  page.once('dialog', (d) => void d.accept());
  await page.goto('/schedule/2026-10-03-MAIN-X/adapt');
  await page.getByRole('button', { name: 'Generate adaptation' }).click();
  await expect(page.getByTestId('zh-proposal')).toBeVisible();
  overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, 'adapt page overflows').toBeLessThanOrEqual(0);
  if (dir) await page.screenshot({ path: `${dir}/cs011_adapt_${info.project.name}.png`, fullPage: true });
  await page.goto('/schedule/2026-10-02-MAIN-X/adapt');
  await expect(page.getByTestId('stale-banner')).toBeVisible();
  if (dir) await page.screenshot({ path: `${dir}/cs011_adapt_stale_${info.project.name}.png`, fullPage: true });
});
