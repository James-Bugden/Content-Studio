import { expect, test, type APIRequestContext } from '@playwright/test';

const store = (process.env.CS_E2E_CONTENT_STORE ?? process.env.CS_CONTENT_STORE) === 'db' ? 'db' : 'sheet';
async function control(request: APIRequestContext, data: object) {
  expect((await request.post('/api/test-control', { data })).status()).toBe(200);
}
async function failWrite(request: APIRequestContext) {
  await control(request, store === 'db' ? { kind: 'db_fail_next', op: 'write', code: 'PROVIDER_UNAVAILABLE' }
    : { kind: 'fail', provider: 'sheet', op: 'write', code: 'PROVIDER_UNAVAILABLE' });
}
test.beforeEach(async ({ page }) => {
  await control(page.request, { kind: 'reset' });
  expect((await page.request.post('/api/test-auth', { data: { as: 'owner' } })).status()).toBe(200);
  const health = await (await page.request.get('/api/health')).json();
  expect(health.capabilities).toContainEqual(expect.objectContaining({ provider: store, state: 'ready' }));
});
test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus) await page.screenshot({ path: `tmp/db3/${store}-${info.project.name}-${info.title.startsWith('TYPE') ? 'typefully' : 'editor'}.png`, fullPage: true });
});

test('DRV-03/04: save with a failed store step retries the same operation and preserves exact copy', async ({ page }) => {
  await page.goto('/review/SYN-L001');
  await expect(page.getByText('Content revision', { exact: true })).toBeVisible();
  const exact = 'Synthetic DB saga 漢字 🙂\n\n  exact spacing   ';
  await page.getByLabel(/Post copy/).fill(exact);
  await failWrite(page.request);
  const partialResponse = page.waitForResponse(r => r.url().endsWith('/api/library/SYN-L001/draft') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Save draft' }).click();
  const partial = await (await partialResponse).json();
  expect(partial).toMatchObject({ ok: false, code: 'PARTIAL_FAILURE', steps: [{ provider: 'drive', status: 'done' }, { provider: store, status: 'failed' }] });
  await expect(page.getByText('Some steps still need to run')).toBeVisible();
  await page.getByRole('button', { name: /Retry/ }).click();
  await expect(page.getByText(`Saved to the master Markdown and mirrored to the ${store === 'db' ? 'database' : 'Sheet'}.`)).toBeVisible();
  const { model } = await (await page.request.get('/api/library/SYN-L001/editor')).json();
  expect(model.sheet.draft).toBe(exact); expect(model.markdown.body).toBe(exact);
  await page.reload();
  await expect(page.getByLabel(/Post copy/)).toHaveValue(exact);
});

test('stale editor refuses an external edit and keeps the proposed text', async ({ page }) => {
  await page.goto('/review/SYN-L001');
  await page.getByLabel(/Post copy/).fill('My proposed synthetic copy');
  await control(page.request, store === 'db'
    ? { kind: 'db_external_edit', collection: 'library', id: 'SYN-L001', patch: { draftContent: 'External synthetic copy' } }
    : { kind: 'sheet_edit', libraryId: 'SYN-L001', header: 'Draft Content', value: 'External synthetic copy' });
  await page.getByRole('button', { name: 'Save draft' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('External synthetic copy')).toBeVisible();
  await expect(dialog.getByText('My proposed synthetic copy')).toBeVisible();
  const { model } = await (await page.request.get('/api/library/SYN-L001/editor')).json();
  expect(model.sheet.draft).toBe('External synthetic copy');
});

test('TYPE-02: provider create then store failure retries without a second draft', async ({ page }) => {
  const id = '2026-10-02-MAIN-LI';
  await page.goto(`/schedule/${id}`);
  await expect(page.getByRole('button', { name: 'Create a planned draft in Typefully' })).toBeVisible();
  await failWrite(page.request);
  const detail = await (await page.request.get(`/api/schedule/${id}/typefully`)).json();
  const input = { operationId: 'synthetic_e2e_typefully_partial', expectedRevision: detail.view.row.revision };
  const options = { headers: { origin: new URL(page.url()).origin }, data: input };
  const first = await (await page.request.post(`/api/schedule/${id}/typefully/create`, options)).json();
  expect(first).toMatchObject({ ok: false, code: 'PARTIAL_FAILURE' });
  expect(first.steps).toContainEqual(expect.objectContaining({ provider: store, status: 'failed' }));
  const retry = await (await page.request.post(`/api/schedule/${id}/typefully/create`, options)).json();
  expect(retry.ok).toBe(true);
  expect(retry.revision).toMatch(/^[a-f0-9]{16}$/);
  const linked = await (await page.request.get(`/api/schedule/${id}/typefully`)).json();
  expect(linked.view.row.revision).toBe(retry.revision);
  const drafts = await (await page.request.post('/api/test-control', { data: { kind: 'typefully', action: { type: 'list' } } })).json();
  expect(drafts.drafts.filter((d: { platform: string }) => d.platform === 'LinkedIn')).toHaveLength(1);
  await page.reload();
  await expect(page.locator('[data-typefully-state="linked"]')).toBeVisible();
});
