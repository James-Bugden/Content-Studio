import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * CS-008 Protected Post Editor journeys (T1) on synthetic fakes.
 */
const MASTER = 'SYNTH_master_negotiation_md';

async function signInAs(request: APIRequestContext, as: 'owner' | 'viewer') {
  expect((await request.post('/api/test-auth', { data: { as } })).status()).toBe(200);
}
async function control(request: APIRequestContext, data: Record<string, unknown>) {
  expect((await request.post('/api/test-control', { data })).status()).toBe(200);
}
const editor = (page: Page) => page.getByLabel(/Post copy/);

test.beforeEach(async ({ page }) => {
  await control(page.request, { kind: 'reset' });
  await signInAs(page.request, 'owner');
});

test('a denied Drive read explains the access problem and never enables Save', async ({ page }) => {
  await control(page.request, { kind: 'fail', provider: 'drive', op: 'read', code: 'FORBIDDEN' });
  await page.goto('/review/SYN-L001');
  await expect(page.getByText('Google Drive denied access to the master file.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save draft' })).toBeDisabled();
});

test('REV-07: exact emoji, CJK, whitespace and line breaks round-trip', async ({ page }) => {
  await page.goto('/review/SYN-L008');
  const exact = '談薪水不是吵架 🙂\n\n  indented line\t\n\n\nlast line with trailing spaces   ';
  await editor(page).fill(exact);
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Saved to the master Markdown and mirrored to the Sheet.')).toBeVisible();
  const res = await page.request.get('/api/library/SYN-L008/editor');
  const body = (await res.json()) as { model: { sheet: { draft: string }; markdown: { body: string }; mismatch: boolean } };
  expect(body.model.sheet.draft).toBe(exact);
  expect(body.model.markdown.body).toBe(exact);
  expect(body.model.mismatch).toBe(false);
  await page.reload();
  await expect(editor(page)).toHaveValue(exact);
});

test('REV-08: an external Markdown edit becomes a three-way comparison, not last-write-wins', async ({ page }) => {
  await page.goto('/review/SYN-L001');
  await editor(page).fill('My version of the post.');
  await control(page.request, { kind: 'drive_replace', fileId: MASTER, find: 'Scope decides the salary band.', replace: 'Changed in Drive meanwhile.' });
  await page.getByRole('button', { name: 'Save draft' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Changed in Drive meanwhile.')).toBeVisible();
  await expect(dialog.getByText('My version of the post.')).toBeVisible();
  // Nothing was overwritten.
  const before = (await (await page.request.get('/api/library/SYN-L001/editor')).json()) as { model: { markdown: { body: string } } };
  expect(before.model.markdown.body).toContain('Changed in Drive meanwhile.');
  await dialog.getByRole('button', { name: 'Keep mine and review again' }).click();
  await expect(editor(page)).toHaveValue('My version of the post.');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Saved to the master Markdown and mirrored to the Sheet.')).toBeVisible();
});

test('two tabs: the second save conflicts instead of overwriting the first', async ({ page, context }) => {
  const second = await context.newPage();
  await page.goto('/review/SYN-L005');
  await second.goto('/review/SYN-L005');
  await editor(page).fill('First tab text.');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Saved to the master Markdown and mirrored to the Sheet.')).toBeVisible();
  await editor(second).fill('Second tab text.');
  await second.getByRole('button', { name: 'Save draft' }).click();
  await expect(second.getByRole('dialog')).toBeVisible();
  await expect(second.getByRole('dialog').getByText('First tab text.')).toBeVisible();
});

test('DRV-04: Sheet failure after the Markdown write shows steps and a same-operation retry', async ({ page }) => {
  await page.goto('/review/SYN-L001');
  await editor(page).fill('Retry me.');
  await control(page.request, { kind: 'fail', provider: 'sheet', op: 'write', code: 'PROVIDER_UNAVAILABLE' });
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Some steps still need to run')).toBeVisible();
  await page.getByRole('button', { name: /Retry/ }).click();
  await expect(page.getByText('Saved to the master Markdown and mirrored to the Sheet.')).toBeVisible();
  const model = (await (await page.request.get('/api/library/SYN-L001/editor')).json()) as { model: { sheet: { draft: string }; markdown: { body: string } } };
  expect(model.model.sheet.draft).toBe('Retry me.');
  expect(model.model.markdown.body).toBe('Retry me.');
});

test('UX-06: a dirty draft survives a reload through tab-local recovery and asks before leaving', async ({ page }) => {
  await page.goto('/review/SYN-L001');
  await editor(page).fill('Unsaved words 未儲存');
  await page.waitForTimeout(600);
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Calendar' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: /Stay/ }).click();
  await expect(editor(page)).toHaveValue('Unsaved words 未儲存');
  page.once('dialog', (d) => void d.accept());
  await page.reload();
  await page.getByRole('button', { name: 'Restore it' }).click();
  await expect(editor(page)).toHaveValue('Unsaved words 未儲存');
});

test('a Sheet and Markdown mismatch is shown and can be reconciled explicitly', async ({ page }) => {
  await control(page.request, { kind: 'sheet_edit', libraryId: 'SYN-L001', header: 'Draft Content', value: 'Old Sheet mirror' });
  await page.goto('/review/SYN-L001');
  await expect(page.getByText('The Sheet draft and the Markdown section differ.').first()).toBeVisible();
  await page.getByRole('button', { name: 'Make the Sheet match the Markdown' }).click();
  await expect(page.getByText(/mirrored to the Sheet|Already saved/)).toBeVisible();
  const model = (await (await page.request.get('/api/library/SYN-L001/editor')).json()) as { model: { mismatch: boolean } };
  expect(model.model.mismatch).toBe(false);
});

test('viewer gets a read-only editor and the save API refuses', async ({ page }) => {
  await signInAs(page.request, 'viewer');
  await page.goto('/review/SYN-L001');
  await expect(editor(page)).toHaveAttribute('readonly', '');
  await expect(page.getByRole('button', { name: 'Save draft' })).toHaveCount(0);
  const res = await page.request.post('/api/library/SYN-L001/draft', {
    headers: { origin: new URL(page.url()).origin },
    data: { operationId: 'op_e2e_viewer_save', expectedSheetRevision: '0000000000000000', expectedSectionHash: '0000000000000000', proposed: 'x' },
  });
  expect(res.status()).toBe(403);
});
