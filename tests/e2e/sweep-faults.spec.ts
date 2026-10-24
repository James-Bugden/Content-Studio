import { expect, test } from '@playwright/test';
import { ERROR_CATALOGUE } from '../../src/domain/errors';
import { control, signIn, observe, report, settled, designatedState, noWrites, overflow, navigate, FAULTS, SHEET_READERS } from './sweep-checks';

for (const [code, kind] of FAULTS) {
  test(`fault sweep: ${code}`, async ({ page }, info) => {
    test.setTimeout(150_000);
    await signIn(page, 'owner');
    const monitor = observe(page);
    const coverage = report(page, info, 'owner');
    try {
      for (const role of ['owner', 'viewer'] as const) {
        await signIn(page, role);
        for (const [route, tab] of SHEET_READERS) {
          // Promotion is owner-only and refuses the viewer before any provider
          // read; its forbidden state is covered by the normal route sweep.
          if (role === 'viewer' && route.startsWith('/ready/')) continue;
          await coverage.check(route, `sheet/read/${code}`, async () => {
            await control(page, { kind: 'reset' });
            await control(page, { kind: 'fail', provider: 'sheet', op: 'read', tab, code, times: 10 });
            await navigate(page, route);
            await settled(page);
            await designatedState(page, kind);
            expect(await page.locator('[data-state="empty"], [data-state="no_match"]').count(), 'primary dataset fault disguised as empty data').toBe(0);
            await noWrites(page);
            await overflow(page);
            await monitor.assertClean();
          }, role);
        }
      }
      await signIn(page, 'owner');
      for (const provider of ['sheet', 'drive', 'typefully'] as const) {
        await coverage.check('/reconcile', `${provider}/read/${code}`, async () => {
          await control(page, { kind: 'reset' });
          await control(page, provider === 'typefully' ? { kind: 'typefully', action: { type: 'fail', code, op: 'listDrafts' } } :
            { kind: 'fail', provider, op: 'read', code, times: 10 });
          await navigate(page, '/reconcile');
          await settled(page);
          await expect(page.locator('[data-state="provider_error"]').filter({ hasText: 'Some sources could not be read' })).toBeVisible();
          await noWrites(page);
          await monitor.assertClean();
        });
      }
      for (const op of ['read'] as const) {
        await coverage.check('/review/SYN-L001', `drive/${op}/${code}`, async () => {
          await control(page, { kind: 'reset' });
          await control(page, { kind: 'fail', provider: 'drive', op, code, times: 10 });
          await navigate(page, '/review/SYN-L001');
          await settled(page);
          // Drive read failures use an InlineResult instead of ErrorState by design.
          await expect(page.getByText(/Saving is disabled so the Sheet and Markdown cannot drift apart/)).toBeVisible();
          await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeDisabled();
          await monitor.assertClean();
        });
      }
      for (const route of ['/schedule/2026-10-02-MAIN-X', '/schedule/2026-10-01-MAIN-LI']) {
        await coverage.check(route, `typefully/read/${code}`, async () => {
          await control(page, { kind: 'reset' });
          await control(page, { kind: 'typefully', action: { type: 'fail', code } });
          await navigate(page, route);
          await settled(page);
          await expect(page.locator('[data-typefully-state="provider_error"]')).toBeVisible();
          await noWrites(page);
          await monitor.assertClean();
        });
      }
      for (const [route, button, endpoint] of [
        ['/review/SYN-L001', 'Check English', '/api/library/SYN-L001/qa'],
        ['/review/SYN-L001', 'Suggest three hooks', '/api/library/SYN-L001/hooks'],
        ['/schedule/2026-10-03-MAIN-X/adapt', 'Generate adaptation', '/api/schedule/2026-10-03-MAIN-X/zh'],
      ] as const) {
        await coverage.check(route, `ai/${button}/${code}`, async () => {
          await control(page, { kind: 'reset' });
          await navigate(page, route);
          await control(page, { kind: 'ai_fail', code });
          const status = ERROR_CATALOGUE[code].status;
          if (status >= 400) monitor.expectResponse(endpoint, status);
          await page.getByRole('button', { name: button, exact: true }).click();
          await designatedState(page, kind);
          // A secondary section may legitimately be empty (e.g. alternatives
          // never supplied). The AI operation must still show its typed failure.
          if (route.startsWith('/review')) await expect(page.getByLabel(/Post copy/)).toBeEditable();
          else await expect(page.getByTestId('zh-proposal')).toHaveCount(0);
          await monitor.assertClean();
        });
      }
    } finally { await coverage.finish(); }
  });
}
