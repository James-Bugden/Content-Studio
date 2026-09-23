import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * CS-015 / CS-016 journeys (T1) against the fake Typefully: reconciliation
 * states, idempotent create, explicit sync direction, conflicts, the Published
 * library and viewer permissions. The fake has no idempotency key, like the real
 * API, so "one draft" here proves the service's lookup-before-create logic.
 */
const X1 = '2026-10-01-MAIN-X';
const TH1 = '2026-10-01-MAIN-TH';
const X2 = '2026-10-02-MAIN-X';
const LI2 = '2026-10-02-MAIN-LI';
const X2_CONTENT = 'Ask for the band.\n\nThen ask where you sit in it. (edited)';
const EXOTIC = '談薪水不是吵架 🙂\r\n\r\n  – their budget  \n\tyour market value  \n\nEnd with a question.   ';

type Draft = { id: string; platform: string; text: string; status: string; scheduledAt: string | null };
type Detail = {
  row: { draftId: string; revision: string };
  panel: { kind: string; comparison?: { sheetWorking: string; sheetFinal: string; typefully: string } };
};

async function signInAs(request: APIRequestContext, as: 'owner' | 'viewer') {
  expect((await request.post('/api/test-auth', { data: { as } })).status()).toBe(200);
}

async function tf(request: APIRequestContext, action: Record<string, unknown>) {
  const res = await request.post('/api/test-control', { data: { kind: 'typefully', action } });
  expect(res.status()).toBe(200);
  return (await res.json()) as { ok: true; drafts?: Draft[]; draftId?: string };
}

async function drafts(request: APIRequestContext, platform: string): Promise<Draft[]> {
  return ((await tf(request, { type: 'list' })).drafts ?? []).filter((d) => d.platform === platform);
}

async function detail(request: APIRequestContext, contentId: string): Promise<Detail> {
  const res = await request.get(`/api/schedule/${contentId}/typefully`);
  expect(res.status()).toBe(200);
  return ((await res.json()) as { view: Detail }).view;
}

async function scheduleEdit(request: APIRequestContext, contentId: string, header: string, value: string) {
  expect((await request.post('/api/test-control', { data: { kind: 'schedule_edit', contentId, header, value } })).status()).toBe(200);
}

const pane = (page: Page, name: string) => page.getByRole('region', { name, exact: true });

test.beforeEach(async ({ page }) => {
  expect((await page.request.post('/api/test-control', { data: { kind: 'reset' } })).status()).toBe(200);
  await signInAs(page.request, 'owner');
});

test('TYPE-01: an existing Draft ID shows the linked view with three labelled panes', async ({ page }) => {
  await page.goto('/schedule?week=2026-10-01');
  await page.getByRole('link', { name: `Details for ${X2}` }).click();
  await expect(page).toHaveURL(new RegExp(`/schedule/${X2}$`));
  await expect(page.getByRole('heading', { name: 'Row facts' })).toBeVisible();
  await expect(page.locator('[data-typefully-state="linked"]')).toBeVisible();
  await expect(pane(page, 'Sheet working copy')).toContainText('(edited)');
  await expect(pane(page, 'Sheet final copy')).toContainText('Empty');
  await expect(pane(page, 'Typefully current text')).toContainText('before you name a number');
  await expect(page.getByText(/Which is newer:/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Take Typefully’s text into Final Content' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send the Sheet text to Typefully' })).toBeVisible();
});

test('TYPE-02: no match, then a double click on create makes one planned draft and one link', async ({ page }) => {
  await page.goto(`/schedule/${LI2}`);
  await expect(page.getByText('No Typefully draft matches this slot')).toBeVisible();
  await expect(page.getByText(/does not publish automatically/)).toBeVisible();
  await page.getByRole('button', { name: 'Create a planned draft in Typefully' }).dblclick();
  await expect(page.getByText(/planned draft in Typefully and linked it|earlier attempt had already created/)).toBeVisible();
  await expect(pane(page, 'Typefully current text')).toContainText('Old post using a screenshot.');
  const view = await detail(page.request, LI2);
  expect(view.row.draftId).toMatch(/^SYNTH-TF-\d+$/);
  expect(view.panel.kind).toBe('linked');
  const li = await drafts(page.request, 'LinkedIn');
  expect(li).toHaveLength(1);
  expect(li[0]!.id).toBe(view.row.draftId);
  expect(li[0]!.status).not.toBe('Scheduled');
});

test('TYPE-02: a timeout after create, then retry, still leaves one draft', async ({ page }) => {
  await tf(page.request, { type: 'timeout_after_create' });
  await page.goto(`/schedule/${LI2}`);
  await page.getByRole('button', { name: 'Create a planned draft in Typefully' }).click();
  await expect(page.getByText(/may or may not exist/)).toBeVisible();
  expect(await drafts(page.request, 'LinkedIn')).toHaveLength(1);
  expect((await detail(page.request, LI2)).row.draftId).toBe('');
  await page.getByRole('button', { name: 'Create a planned draft in Typefully' }).click();
  await expect(page.getByText(/earlier attempt had already created the draft/)).toBeVisible();
  const li = await drafts(page.request, 'LinkedIn');
  expect(li).toHaveLength(1);
  expect((await detail(page.request, LI2)).row.draftId).toBe(li[0]!.id);
});

test('TYPE-03: ambiguous candidates are never auto-linked and need an explicit pick', async ({ page }) => {
  const a = (await tf(page.request, { type: 'add', platform: 'LinkedIn', text: 'Old post using a screenshot.', scheduleAt: '2026-10-02T13:00:00Z' })).draftId!;
  const b = (await tf(page.request, { type: 'add', platform: 'LinkedIn', text: 'A different LinkedIn post.', scheduleAt: '2026-10-02T13:10:00Z' })).draftId!;
  await page.goto(`/schedule/${LI2}`);
  await expect(page.getByText('2 Typefully drafts could match this slot')).toBeVisible();
  const second = page.getByRole('article', { name: `Candidate ${b}` });
  await expect(second).toContainText('2026-10-02');
  await expect(second).toContainText('21:10');
  await expect(second).toContainText('LinkedIn');
  await expect(second).toContainText('10 min apart');
  await expect(page.getByRole('article', { name: `Candidate ${a}` })).toContainText('100%');
  await expect(page.getByRole('button', { name: 'Create a planned draft in Typefully' })).toHaveCount(0);
  expect((await detail(page.request, LI2)).row.draftId).toBe('');

  // A direct create is refused too: nothing new in Typefully.
  const revision = (await detail(page.request, LI2)).row.revision;
  const refused = await page.request.post(`/api/schedule/${LI2}/typefully/create`, {
    headers: { origin: new URL(page.url()).origin },
    data: { operationId: 'op_e2e_amb_create', expectedRevision: revision },
  });
  expect(refused.status()).toBe(409);
  expect(await drafts(page.request, 'LinkedIn')).toHaveLength(2);

  await second.getByRole('button', { name: 'Link this draft' }).click();
  await expect(page.getByText(`Linked Typefully draft ${b} to ${LI2}.`)).toBeVisible();
  expect((await detail(page.request, LI2)).row.draftId).toBe(b);
});

test('TYPE-04: exact Unicode and whitespace land in Final Content; Content is unchanged', async ({ page }) => {
  await tf(page.request, { type: 'edit', draftId: 'SYNTH-TF-1003', text: EXOTIC });
  await page.goto(`/schedule/${X2}`);
  await page.getByRole('button', { name: 'Take Typefully’s text into Final Content' }).click();
  await expect(page.getByText(/exact text is now in Final Content/)).toBeVisible();
  const view = await detail(page.request, X2);
  expect(view.panel.comparison?.sheetFinal).toBe(EXOTIC);
  expect(view.panel.comparison?.typefully).toBe(EXOTIC);
  expect(view.panel.comparison?.sheetWorking).toBe(X2_CONTENT);
});

test('TYPE-05: both sides edited after a sync is a conflict; nothing is overwritten until an explicit choice', async ({ page }) => {
  await page.goto(`/schedule/${X2}`);
  await page.getByRole('button', { name: 'Take Typefully’s text into Final Content' }).click();
  await expect(page.getByText(/exact text is now in Final Content/)).toBeVisible();

  await scheduleEdit(page.request, X2, 'Final Content', 'Sheet edit after the sync');
  await tf(page.request, { type: 'edit', draftId: 'SYNTH-TF-1003', text: 'Typefully edit after the sync' });
  await page.reload();
  await expect(page.getByText(/Both changed after the last sync/)).toBeVisible();

  await page.getByRole('button', { name: 'Take Typefully’s text into Final Content' }).click();
  const syncDialog = page.getByRole('dialog', { name: 'Final Content was edited in the Sheet' });
  await expect(syncDialog).toBeVisible();
  await expect(syncDialog.getByRole('region', { name: 'Current' })).toContainText('Sheet edit after the sync');
  await expect(syncDialog.getByRole('region', { name: 'Proposed' })).toContainText('Typefully edit after the sync');
  let view = await detail(page.request, X2);
  expect(view.panel.comparison?.sheetFinal).toBe('Sheet edit after the sync');
  expect(view.panel.comparison?.typefully).toBe('Typefully edit after the sync');
  await syncDialog.getByRole('button', { name: 'Close and decide later' }).click();

  await page.getByRole('button', { name: 'Send the Sheet text to Typefully' }).click();
  const pushDialog = page.getByRole('dialog', { name: 'Typefully was edited' });
  await expect(pushDialog).toBeVisible();
  view = await detail(page.request, X2);
  expect(view.panel.comparison?.sheetFinal).toBe('Sheet edit after the sync');
  expect(view.panel.comparison?.typefully).toBe('Typefully edit after the sync');

  await pushDialog.getByRole('button', { name: 'Take Typefully’s text into Final Content' }).click();
  await expect(page.getByText(/exact text is now in Final Content/)).toBeVisible();
  view = await detail(page.request, X2);
  expect(view.panel.comparison?.sheetFinal).toBe('Typefully edit after the sync');
  expect(view.panel.comparison?.sheetWorking).toBe(X2_CONTENT);
});

test('Threads: a stale adaptation refuses create with the service reason', async ({ page }) => {
  await scheduleEdit(page.request, '2026-10-02-MAIN-TH', 'Content Stage', 'Ready');
  await page.goto('/schedule/2026-10-02-MAIN-TH');
  await expect(page.getByText(/The Chinese adaptation is out of date/)).toBeVisible();
  await page.getByRole('button', { name: 'Create a planned draft in Typefully' }).click();
  await expect(page.getByText(/Not created: the Chinese adaptation is out of date/)).toBeVisible();
  expect(await drafts(page.request, 'Threads')).toHaveLength(1);
});

test('PUB-01/02/05: X and Threads are separate, blank is not zero, totals state their denominators', async ({ page }) => {
  await page.goto('/published');
  await expect(page.getByRole('heading', { level: 2, name: /^X \(1\)/ })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: /^Threads \(1\)/ })).toBeVisible();
  const x = page.getByRole('article', { name: `X ${X1}` });
  const th = page.getByRole('article', { name: `Threads ${TH1}` });
  await expect(x.locator('tr[data-metric="replies"] td')).toHaveText('0');
  await expect(x.locator('tr[data-metric="newFollowers"] td')).toHaveText('Not available from Typefully');
  await expect(x.getByRole('region', { name: 'Final Content' })).toContainText('Treat it like one.');
  await expect(th.locator('tr[data-metric="views"] td')).toHaveText('830');
  await expect(th.locator('tr[data-metric="reposts"] td')).toHaveText('Not available from Typefully');
  await expect(th).toContainText(X1);
  await expect(th).toContainText('Needs reconciliation');

  await expect(page.getByText(/Missing values are not counted as zero/)).toBeVisible();
  const xTotals = page.getByRole('region', { name: 'X totals' });
  await expect(xTotals).toContainText('Date range: all time');
  await expect(xTotals).toContainText('Rows included: 1');
  await expect(xTotals).toContainText('Last analytics sync:');
  await expect(xTotals.locator('tr[data-metric="newFollowers"]')).toContainText('No values');
  await expect(xTotals.locator('tr[data-metric="newFollowers"]')).toContainText('0 of 1');
  const thTotals = page.getByRole('region', { name: 'Threads totals' });
  await expect(thTotals.locator('tr[data-metric="views"]')).toContainText('830');

  await page.goto('/published?platform=Threads');
  await expect(page.getByRole('article', { name: `X ${X1}` })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'X totals' })).toHaveCount(0);
  await expect(page.getByRole('article', { name: `Threads ${TH1}` })).toBeVisible();
});

test('PUB-03: syncing analytics twice is idempotent', async ({ page }) => {
  await tf(page.request, { type: 'set_metrics', draftId: 'SYNTH-TF-1001', metrics: { views: 2000, likes: 50, reposts: 6, replies: 0, bookmarks: 11 } });
  await page.goto('/published');
  const x = page.getByRole('article', { name: `X ${X1}` });
  await x.getByRole('button', { name: 'Sync analytics' }).click();
  await expect(x.getByText(/Analytics synced: 5 metrics from Typefully; 1 not available/)).toBeVisible();
  await expect(x.locator('tr[data-metric="views"] td')).toHaveText('2,000');
  await expect(x.locator('tr[data-metric="newFollowers"] td')).toHaveText('Not available from Typefully');
  await x.getByRole('button', { name: 'Sync analytics' }).click();
  await expect(x.getByText('Analytics already up to date. Nothing was written.')).toBeVisible();
  await expect(x.locator('tr[data-metric="views"] td')).toHaveText('2,000');
});

test('PUB-04: a post link disagreement is reported, not corrected', async ({ page }) => {
  await scheduleEdit(page.request, X1, 'Post Link', 'https://x.com/example/status/999');
  await page.goto(`/published/${X1}`);
  const x = page.getByRole('article', { name: `X ${X1}` });
  await x.getByRole('button', { name: 'Sync analytics' }).click();
  await expect(x.getByText(/Post Link in the Sheet differs from Typefully. Nothing was changed/)).toBeVisible();
  await page.reload();
  await expect(page.getByRole('link', { name: /Open the post/ })).toHaveAttribute('href', 'https://x.com/example/status/999');
});

test('viewer sees the pages but no actions, and every Typefully write API is 403', async ({ page }) => {
  await signInAs(page.request, 'viewer');
  await page.goto(`/schedule/${X2}`);
  await expect(pane(page, 'Typefully current text')).toBeVisible();
  await expect(page.getByText(/Read only: only the owner/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Take Typefully’s text into Final Content' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Send the Sheet text to Typefully' })).toHaveCount(0);
  await page.goto('/published');
  await expect(page.getByRole('article', { name: `X ${X1}` })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sync analytics' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sync final copy' })).toHaveCount(0);

  const view = await detail(page.request, X2);
  const origin = new URL(page.url()).origin;
  for (const [path, extra] of [
    ['create', {}],
    ['link', { draftId: 'SYNTH-TF-1003' }],
    ['sync-final', {}],
    ['push', {}],
    ['analytics', {}],
  ] as const) {
    const res = await page.request.post(`/api/schedule/${X2}/typefully/${path}`, { headers: { origin }, data: { operationId: `op_e2e_viewer_${path.replace('-', '_')}`, expectedRevision: view.row.revision, ...extra } });
    expect(res.status(), path).toBe(403);
  }
});

test('provider failure is its own state and review keeps working', async ({ page }) => {
  await tf(page.request, { type: 'fail', code: 'PROVIDER_UNAVAILABLE', op: 'getDraft' });
  await page.goto(`/schedule/${X2}`);
  await expect(page.getByText('Typefully could not be checked')).toBeVisible();
  await expect(page.getByText(/Review and scheduling keep working/)).toBeVisible();
  await page.getByRole('button', { name: 'Check again' }).click();
  await expect(pane(page, 'Typefully current text')).toBeVisible();
});
