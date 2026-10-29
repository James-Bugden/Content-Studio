import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { cutoverBuild, cutoverStatus } from '../fixtures/cutover';

// Real authenticated app shell on the fake-provider server. The cutover HTTP
// adapter below supplies synthetic gate/receipt data; no SQL, flags or providers
// are changed. Real route auth/claims/SQL are exercised by the unit/PGlite tests.
test('Database switch: deliberate confirmation, retry, stale refusal and accessible phone/desktop layout', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  expect((await page.request.post('/api/test-control', { data: { kind: 'reset' } })).ok()).toBe(true);
  expect((await page.request.post('/api/test-auth', { data: { as: 'owner' } })).ok()).toBe(true);
  const state = cutoverStatus(), keys: string[] = [];
  let loseResponse = true;
  await page.route('**/api/ops/content-cutover', async route => {
    const request = route.request();
    if (request.method() === 'GET') return route.fulfill({ json: { ok:true, status:state } });
    const body = request.postDataJSON(); keys.push(request.headers()['idempotency-key']!);
    expect(request.headers()['authorization']).toBeUndefined();
    if (body.action === 'backup') {
      if (loseResponse) { loseResponse = false; return route.abort('timedout'); }
      return route.fulfill({ json: { ok:true, result:{status:'verified', manifestHash:'b'.repeat(64)} } });
    }
    expect(body).toEqual({action:'activate-read', expectedBuild:cutoverBuild});
    return route.fulfill({ json: { ok:true, result:{mode:'db-read', build:cutoverBuild, contract:state.contract} } });
  });
  await page.goto('/reconcile');
  const panel = page.getByRole('region', { name:'Database switch', exact:true });
  await expect(panel).toContainText(cutoverBuild);
  await expect(panel).toContainText('15-minute freshness window');
  await expect(page.locator('[data-reconcile-checks="ready"]'), 'streamed checks finished').toHaveCount(1);
  await panel.getByRole('button', {name:'Backup check'}).click();
  await expect(panel.getByText(/Completion is unconfirmed. The pending request is kept./)).toBeVisible();
  await page.reload();
  await expect(page.locator('[data-reconcile-checks="ready"]'), 'streamed checks finished').toHaveCount(1);
  await panel.getByRole('button', {name:'Backup check'}).click();
  await expect(panel).toContainText('Backup check verified.'); expect(keys[1]).toBe(keys[0]);
  const open = panel.getByRole('button', {name:'Switch reads to database'});
  await open.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(cutoverBuild);
  const input = dialog.getByLabel('Type ACTIVATE exactly to continue'), confirm = dialog.getByRole('button', {name:'Confirm switch'});
  await input.fill('activate'); await expect(confirm).toBeDisabled();
  await input.fill('ACTIVATE '); await expect(confirm).toBeDisabled();
  await input.fill('ACTIVATE'); await expect(confirm).toBeEnabled();
  expect((await new AxeBuilder({page}).include('dialog').analyze()).violations).toEqual([]);
  const box = await dialog.boundingBox(); expect(box).not.toBeNull();
  if (page.viewportSize()!.width === 375) {
    expect(Math.abs(box!.y + box!.height - page.viewportSize()!.height)).toBeLessThanOrEqual(2);
    expect(box!.width).toBe(375);
  }
  for (const control of await dialog.locator('button,input').all()) expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({path:`test-results/database-switch-confirm-${test.info().project.name}.png`});
  await confirm.click(); await expect(dialog).not.toBeVisible();
  await expect(open).toBeFocused();
  await expect(panel).toContainText('Switch recorded for this exact build');
  await open.click(); await expect(input).toBeEnabled(); await input.fill('ACTIVATE');
  state.gates['db-read'] = {ok:false, reasons:['parity_not_green']};
  await confirm.click(); await expect(dialog.getByRole('alert')).toContainText('readiness changed');
  expect(keys).toHaveLength(3);
  await dialog.getByRole('button', {name:'Cancel'}).click();
  await expect(panel.getByRole('button', {name:'Refresh status'})).toBeFocused(); await expect(open).toBeDisabled();
  expect((await new AxeBuilder({page}).include('[aria-labelledby="database-switch-h"]').analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('Database switch is owner-only on the Fix issues page', async ({page}) => {
  expect((await page.request.post('/api/test-auth', {data:{as:'viewer'}})).ok()).toBe(true);
  await page.goto('/reconcile');
  await expect(page.getByRole('heading', {name:'Fix issues'})).toBeVisible();
  await expect(page.getByRole('region', {name:'Database switch', exact:true})).toHaveCount(0);
});
