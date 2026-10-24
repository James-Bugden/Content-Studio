import { expect, test, type Page } from '@playwright/test';
import { ERROR_CODES } from '../../src/domain/errors';
import { navigate, control, signIn, observe, settled, overflow, axe, keyboard, escapeDialog, designatedState, noWrites, guardedDraft, noDeadEnd, monkey, report, ROUTES, FAULTS } from './sweep-checks';

for (const role of ['owner', 'viewer', 'stranger'] as const) {
  test(`route sweep: ${role}`, async ({ page }, info) => {
    test.setTimeout(180_000);
    await control(page, { kind: 'reset' });
    await signIn(page, role);
    const monitor = observe(page);
    const coverage = report(page, info, role);
    try {
      for (const route of ROUTES) {
        await coverage.check(route, 'load/auth', async () => {
          const response = await navigate(page, route);
          expect(response?.status()).toBe(200);
          await settled(page);
          if (role === 'stranger') await expect(page).toHaveURL(/\/login$/);
          else await expect(page).toHaveURL(new URL(route === '/login' ? '/' : route, page.url()).href);
          if (route.includes('post=') || route.startsWith('/schedule?') && route.includes('slot=')) {
            if (role !== 'stranger') await expect(page.locator('dialog[open]')).toHaveCount(1);
          }
        });
        await coverage.check(route, 'overflow', () => overflow(page));
        await coverage.check(route, 'axe', () => axe(page));
        await coverage.check(route, 'keyboard', () => keyboard(page));
        await coverage.check(route, 'escape', () => escapeDialog(page));
        await coverage.check(route, 'monkey', () => monkey(page, route));
        await coverage.check(route, 'diagnostics', () => monitor.assertClean());
      }
    } finally { await coverage.finish(); }
  });
}

test('sweep inventory matches navigation and injectable fault vocabulary', async ({ page }, info) => {
  const coverage = report(page, info, 'owner');
  try {
    await coverage.check('(coverage contract)', 'inventory', async () => {
      await signIn(page, 'owner');
      await navigate(page, '/');
      await settled(page);
      const nav = await page.getByRole('navigation', { name: 'Primary', exact: true })
        .getByRole('link').evaluateAll((links) => links.map((link) => link.getAttribute('href')));
      expect(nav.length).toBeGreaterThan(0);
      expect(nav.filter((route) => !ROUTES.some((covered) => covered === route)), 'new nav route needs sweep coverage').toEqual([]);
      expect(FAULTS.map(([code]) => code).sort()).toEqual([...ERROR_CODES].sort());
    });
  } finally { await coverage.finish(); }
});

test('dirty guard and conflict keep synthetic edits', async ({ page }, info) => {
  await control(page, { kind: 'reset' });
  await signIn(page, 'owner');
  const monitor = observe(page);
  const coverage = report(page, info, 'owner');
  try {
    await coverage.check('/review/SYN-L001', 'data-loss guard', async () => {
      await navigate(page, '/review/SYN-L001');
      const copy = page.getByLabel(/Post copy/);
      const draft = 'Synthetic unsaved sweep draft.';
      await expect(copy).toBeEditable();
      await copy.fill(draft);
      await expect(copy).toHaveValue(draft);
      await guardedDraft(page, draft);
    });
    await coverage.check('/review/SYN-L001', 'STALE_READ comparison', async () => {
      await control(page, { kind: 'drive_replace', fileId: 'SYNTH_master_negotiation_md',
        find: 'Scope decides the salary band.', replace: 'External synthetic sweep revision.' });
      monitor.expectResponse('/api/library/SYN-L001/draft', 409);
      await page.getByRole('button', { name: 'Save draft', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText('External synthetic sweep revision.');
      await expect(dialog).toContainText('Synthetic unsaved sweep draft.');
      await escapeDialog(page);
      await monitor.assertClean();
    });
  } finally { await coverage.finish(); }
});

// The same detectors used above must reject controlled defects. To demonstrate
// a real nonzero Playwright exit, set CS_SWEEP_MUTATION=<name> and --grep the
// corresponding proof: that run deliberately does not catch the detector error.
const mutations: { name: string; inject: (page: Page) => Promise<unknown>; detect: (page: Page) => Promise<unknown> }[] = [
  { name: 'load', inject: (p) => p.locator('main').evaluate((el) => el.remove()), detect: (p) => settled(p, 250) },
  { name: 'overflow', inject: (p) => p.locator('main').evaluate((el) => { el.style.width = '200vw'; }), detect: overflow },
  { name: 'axe', inject: (p) => p.locator('button').evaluate((el) => { el.textContent = ''; }), detect: axe },
  { name: 'tab-order', inject: (p) => p.locator('button').evaluate((el) => { el.tabIndex = -1; }), detect: keyboard },
  { name: 'keyboard-trap', inject: (p) => p.evaluate(() => {
    document.addEventListener('keydown', (e) => { if (e.key === 'Tab') e.preventDefault(); });
  }), detect: keyboard },
  { name: 'focus', inject: (p) => p.addStyleTag({ content: '*:focus { outline: none !important; box-shadow: none !important; }' }), detect: keyboard },
  { name: 'escape', inject: (p) => p.evaluate(() => {
    const dialog = document.createElement('dialog');
    dialog.textContent = 'Synthetic broken dialog';
    dialog.addEventListener('cancel', (e) => e.preventDefault());
    document.body.append(dialog);
    dialog.showModal();
  }), detect: (p) => escapeDialog(p, 250) },
  { name: 'missing-state', inject: async () => {}, detect: (p) => designatedState(p, 'provider_error', 250) },
  { name: 'unsafe-write', inject: async () => {}, detect: noWrites },
  { name: 'dead-end', inject: (p) => p.locator('main').evaluate((el) => { el.innerHTML = ''; }), detect: noDeadEnd },
];

for (const mutation of mutations) {
  test(`mutation proof: ${mutation.name}`, async ({ page }, info) => {
    await signIn(page, 'owner');
    await navigate(page, '/');
    await page.setContent('<!doctype html><html lang="en"><head><title>Synthetic mutation fixture</title><style>:focus { outline: 2px solid black; }</style></head><body><main><h1>Synthetic fixture</h1><button>Save draft</button><a href="/">Home</a></main></body></html>');
    // Positive control: never credit a mutation whose unmodified fixture fails.
    if (!['missing-state', 'unsafe-write'].includes(mutation.name)) await mutation.detect(page);
    if (mutation.name === 'missing-state') {
      await page.locator('main').evaluate((el) => { el.setAttribute('data-state', 'provider_error'); });
      await mutation.detect(page);
      await page.locator('main').evaluate((el) => el.removeAttribute('data-state'));
    }
    if (mutation.name === 'unsafe-write') {
      await page.locator('button').evaluate((el: HTMLButtonElement) => { el.disabled = true; });
      await mutation.detect(page);
      await page.locator('button').evaluate((el: HTMLButtonElement) => { el.disabled = false; });
    }
    if (mutation.name === 'escape') {
      await page.evaluate(() => {
        const dialog = document.createElement('dialog');
        dialog.textContent = 'Synthetic working dialog';
        document.body.append(dialog);
        dialog.showModal();
      });
      await mutation.detect(page);
    }
    await mutation.inject(page);
    const coverage = report(page, info, 'owner');
    try {
      await coverage.check('(mutation fixture)', `mutation/${mutation.name}`, async () => {
        if (process.env.CS_SWEEP_MUTATION === mutation.name) await mutation.detect(page);
        else await expect(mutation.detect(page)).rejects.toThrow();
      });
    } finally { await coverage.finish(); }
  });
}

test('mutation proof: data-loss-guard', async ({ page }, info) => {
  await control(page, { kind: 'reset' });
  await signIn(page, 'owner');
  await navigate(page, '/review/SYN-L001');
  const draft = 'Synthetic mutation draft retained in this tab.';
  const copy = page.getByLabel(/Post copy/);
  await expect(copy).toBeEditable();
  await copy.fill(draft);
  await expect(page.getByText('Unsaved changes, kept in this tab until you save')).toBeVisible();
  await guardedDraft(page, draft);
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Next up', exact: true }).evaluate((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      history.pushState(null, '', '/');
    }, { capture: true });
  });
  const coverage = report(page, info, 'owner');
  try {
    await coverage.check('/review/SYN-L001', 'mutation/data-loss-guard', async () => {
      if (process.env.CS_SWEEP_MUTATION === 'data-loss-guard') await guardedDraft(page, draft, 250);
      else await expect(guardedDraft(page, draft, 250)).rejects.toThrow();
    });
  } finally { await coverage.finish(); }
});

for (const kind of ['pageerror', 'console-error', 'console-warning', 'hydration', 'requestfailed', 'router-requestfailed', 'http'] as const) {
  test(`mutation proof: ${kind}`, async ({ page }, info) => {
    await signIn(page, 'owner');
    await navigate(page, '/');
    const monitor = observe(page);
    await monitor.assertClean();
    if (kind === 'pageerror') {
      const raised = page.waitForEvent('pageerror');
      await page.evaluate(() => { queueMicrotask(() => { throw new Error('Synthetic sweep mutation'); }); });
      await raised;
    } else if (kind === 'requestfailed' || kind === 'router-requestfailed' || kind === 'http') {
      await page.route('**/api/sweep-mutation*', (route) => kind === 'http' ? route.fulfill({ status: 503, body: 'Synthetic failure' }) : route.abort(kind === 'router-requestfailed' ? 'aborted' : 'failed'));
      const observed = kind === 'http'
        ? page.waitForEvent('response', (event) => new URL(event.url()).pathname === '/api/sweep-mutation')
        : page.waitForEvent('requestfailed', (event) => new URL(event.url()).pathname === '/api/sweep-mutation');
      await page.evaluate((kind) => fetch(kind === 'router-requestfailed' ? '/api/sweep-mutation?_rsc=mutation' : '/api/sweep-mutation',
        kind === 'router-requestfailed' ? { headers: { rsc: '1' } } : {}).catch(() => undefined), kind);
      await observed;
    } else {
      const observed = page.waitForEvent('console', (m) => ['warning', 'error'].includes(m.type()));
      await page.evaluate((kind) => {
        if (kind === 'console-warning') console.warn('Synthetic sweep warning');
        else console.error(kind === 'hydration' ? 'Hydration failed: synthetic sweep mutation' : 'Synthetic sweep error');
      }, kind);
      await observed;
    }
    const coverage = report(page, info, 'owner');
    try {
      await coverage.check('(mutation fixture)', `mutation/${kind}`, async () => {
        if (process.env.CS_SWEEP_MUTATION === kind) await monitor.assertClean();
        else await expect(monitor.assertClean()).rejects.toThrow();
      });
    } finally { await coverage.finish(); }
  });
}
