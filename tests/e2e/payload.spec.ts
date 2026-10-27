import { expect, test } from '@playwright/test';

test('list documents stay bounded with 2,000 synthetic posts', async ({ page }, testInfo) => {
  expect((await page.request.post('/api/test-control', { data: { kind: 'reset' } })).ok()).toBeTruthy();
  expect((await page.request.post('/api/test-auth', { data: { as: 'owner' } })).ok()).toBeTruthy();
  expect((await page.request.post('/api/test-control', { data: { kind: 'seed_library_pages', total: 2000 } })).ok()).toBeTruthy();
  const measurements = [];
  for (const path of ['/', '/backlog', '/schedule', '/review']) {
    await page.request.get(path);
    const samples = [];
    let bytes = 0;
    for (let i = 0; i < 3; i++) {
      const start = performance.now();
      const response = await page.request.get(path);
      const body = await response.body();
      samples.push(Math.round(performance.now() - start));
      expect(response.ok()).toBeTruthy();
      bytes = body.byteLength;
    }
    measurements.push({ path, bytes, warmMs: samples });
  }
  console.log(JSON.stringify(measurements));
  await testInfo.attach('payload.json', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' });
  for (const result of measurements.filter(r => ['/', '/backlog'].includes(r.path))) expect(result.bytes, result.path).toBeLessThan(300_000);
  await page.goto('/');
  await expect(page.locator('[data-task]')).toHaveCount(24);
  const urgent = page.getByRole('navigation', { name: 'Urgent task pages' });
  const first = await page.locator('[data-task]').first().getAttribute('data-task');
  await urgent.getByRole('link', { name: 'Next page' }).click();
  await expect(page).toHaveURL(/nowPage=2/);
  await expect(page.locator('[data-task]').first()).not.toHaveAttribute('data-task', first!);
  await expect(page.locator('[data-task]')).toHaveCount(24);
});

test('long draft bodies stay out of documents and search responses and load on open', async ({ page }) => {
  expect((await page.request.post('/api/test-control', { data: { kind: 'reset' } })).ok()).toBeTruthy();
  expect((await page.request.post('/api/test-auth', { data: { as: 'owner' } })).ok()).toBeTruthy();
  const body = 'Synthetic long draft. '.repeat(200) + 'EXACT_SYNTHETIC_TAIL';
  const db = process.env.CS_E2E_CONTENT_STORE === 'db';
  const edit = db ? { kind: 'db_external_edit', collection: 'library', id: 'SYN-L001', patch: { draftContent: body } }
    : { kind: 'sheet_edit', libraryId: 'SYN-L001', header: 'Draft Content', value: body };
  expect((await page.request.post('/api/test-control', { data: edit })).ok()).toBeTruthy();
  const document = await page.request.get('/backlog');
  expect(await document.text()).not.toContain('EXACT_SYNTHETIC_TAIL');
  const response = await page.request.post('/api/backlog/search', { data: { search: 'EXACT_SYNTHETIC_TAIL' }, headers: { Origin: test.info().project.use.baseURL ?? 'http://127.0.0.1:3200' } });
  expect(response.ok()).toBeTruthy();
  const result = await response.json();
  expect(result.total).toBe(1);
  expect(JSON.stringify(result)).not.toContain('EXACT_SYNTHETIC_TAIL');
  expect(result.rows[0].value.draftContent.length).toBeLessThanOrEqual(220);
  const editorRequests: string[] = [];
  page.on('request', request => {
    if (request.url().endsWith('/api/library/SYN-L001/editor')) editorRequests.push(request.url());
  });
  await page.goto('/backlog');
  const row = page.locator('[data-backlog-id="SYN-L001"]:visible');
  await expect(row).toContainText('Synthetic long draft.');
  await expect(row).not.toContainText('EXACT_SYNTHETIC_TAIL');
  const excerpt = row.locator('p').filter({ hasText: 'Synthetic long draft.' });
  await expect(excerpt).toHaveCSS('-webkit-line-clamp', '2');
  const showFull = row.getByRole('link', { name: 'Show full post', exact: true });
  expect((await showFull.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(editorRequests).toEqual([]);
  const opened = page.waitForResponse(response => response.url().endsWith('/api/library/SYN-L001/editor'));
  await showFull.click();
  expect((await (await opened).json()).model.sheet.draft).toBe(body);
  await expect(page.getByRole('dialog').getByRole('textbox', { name: /Post copy/ })).toBeVisible();
  if (db) await expect(page.getByRole('dialog').getByRole('textbox', { name: /Post copy/ })).toHaveValue(body);
});
