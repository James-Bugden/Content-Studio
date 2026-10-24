import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Request, type TestInfo } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { ERROR_CATALOGUE, ERROR_CODES } from '../../src/domain/errors';

/** CS-060b: broad, bounded coverage; detailed write journeys stay in their own specs.
 * No severity filtering in axe, no blanket console/network suppression, no sleeps.
 * CI runs one shard with isolated servers per width and no retries.
 */
const SEED = 163;
const ROUTES = [
  '/', '/backlog', '/backlog?view=ideas', '/review', '/review?layout=cards',
  '/ready', '/schedule', '/schedule?view=month&month=2026-10',
  '/schedule?view=list&week=2026-10-01', '/published', '/visuals', '/reconcile',
  '/login', '/replies', '/replies/library', '/replies/resources', '/replies/facts', '/replies/settings',
  '/review/SYN-L001', '/visuals/SYN-L012', '/published/2026-10-01-MAIN-X',
  '/schedule/2026-10-02-MAIN-X', '/schedule/2026-10-03-MAIN-X/adapt',
  '/ready/SYN-L005/promote?slot=2026-10-01-MAIN-LI',
  '/review?post=SYN-L008', '/backlog?post=SYN-L001',
  '/schedule?week=2026-10-01&slot=2026-10-02-MAIN-X',
] as const;
type Role = 'owner' | 'viewer' | 'stranger';
type Row = { route: string; width: number; role: Role; check: string; result: 'pass' | 'fail'; evidence?: string };
type ExpectedResponse = { path: string; status: number };
const pendingRequests = new WeakMap<Page, Set<Request>>();
const routerRequests = new WeakMap<Page, Set<Request>>();
const navigationCancellations = new WeakMap<Page, Set<Request>>();
const navigationActive = new WeakSet<Page>();

function prepareNavigation(page: Page) {
  // A document navigation intentionally cancels the old document's outstanding
  // RSC streams. Credit exact requests, never API failures or arbitrary aborts.
  for (const request of routerRequests.get(page) ?? []) navigationCancellations.get(page)?.add(request);
  navigationActive.add(page);
}
async function navigate(page: Page, route: string) {
  prepareNavigation(page);
  try { return await page.goto(route); }
  finally { navigationActive.delete(page); }
}

async function control(page: Page, data: Record<string, unknown>) {
  expect((await page.request.post('/api/test-control', { data })).status()).toBe(200);
}
async function signIn(page: Page, role: Role) {
  expect((await page.request.post('/api/test-auth', { data: { as: role } })).status()).toBe(200);
}

function observe(page: Page) {
  const errors: string[] = [];
  const intended: ExpectedResponse[] = [];
  // Only Chromium's generic HTTP diagnostic for an EXACT explicitly expected
  // fault response is allowed. It must match an observed response below;
  // hydration diagnostics and application console errors are never allowed.
  const httpDiagnostics: ExpectedResponse[] = [];
  const observedFaults: ExpectedResponse[] = [];
  const pending = new Set<Request>();
  const router = new Set<Request>();
  const cancelled = new Set<Request>();
  pendingRequests.set(page, pending);
  routerRequests.set(page, router);
  navigationCancellations.set(page, cancelled);
  const rsc = (r: Request) => r.method() === 'GET' && r.headers().rsc === '1' && new URL(r.url()).searchParams.has('_rsc');
  const prefetch = (r: Request) => r.method() === 'GET' &&
    new URL(r.url()).searchParams.has('_rsc') &&
    r.headers().rsc === '1' &&
    (/^[123]$/.test(r.headers()['next-router-prefetch'] ?? '') || 'next-router-segment-prefetch' in r.headers());
  page.on('request', (r) => {
    if (!sameOrigin(r.url())) return;
    if (rsc(r)) {
      router.add(r);
      // Hover and click can start competing RSC fetches within one navigation;
      // Next deliberately aborts the superseded one. Mark those exact requests.
      if (navigationActive.has(page)) cancelled.add(r);
    }
    else if (['fetch', 'xhr'].includes(r.resourceType())) pending.add(r);
  });
  page.on('requestfinished', (r) => { pending.delete(r); router.delete(r); cancelled.delete(r); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (!['error', 'warning'].includes(m.type())) return;
    // Next/font preloads every shipped weight; an individual route may not use
    // all three. This exact Chromium performance warning is not an app warning.
    const font = /^The resource (\S+) was preloaded using link preload but not used within a few seconds from the window's load event\. Please make sure it has an appropriate `as` value and it is preloaded intentionally\.$/.exec(m.text());
    if (m.type() === 'warning' && font && sameOrigin(font[1]!) &&
      /^\/_next\/static\/media\/inter_latin_(400|500|600)_normal[-\w.]+\.woff2$/.test(new URL(font[1]!).pathname)) return;
    const diagnostic = /^Failed to load resource: the server responded with a status of (\d{3}) \(.*\)$/.exec(m.text());
    if (diagnostic && m.location().url) {
      httpDiagnostics.push({ path: new URL(m.location().url).pathname, status: Number(diagnostic[1]) });
    } else errors.push(`console ${m.type()}: ${m.text()}`);
  });
  const sameOrigin = (url: string) => new URL(url).origin === new URL(test.info().project.use.baseURL!).origin;
  page.on('requestfailed', (r) => {
    pending.delete(r);
    router.delete(r);
    // Next deliberately cancels speculative RSC prefetches on navigation.
    // Actual document/API/navigation failures are never covered by this rule.
    if ((prefetch(r) || cancelled.delete(r)) && r.failure()?.errorText === 'net::ERR_ABORTED') return;
    if (sameOrigin(r.url())) errors.push(`requestfailed: ${JSON.stringify({ method: r.method(), path: new URL(r.url()).pathname,
      error: r.failure()?.errorText, type: r.resourceType(), rsc: r.headers().rsc,
      prefetch: r.headers()['next-router-prefetch'], segment: r.headers()['next-router-segment-prefetch'],
      hasRscQuery: new URL(r.url()).searchParams.has('_rsc') })}`);
  });
  page.on('response', (r) => {
    if (!sameOrigin(r.url()) || r.status() < 400) return;
    const path = new URL(r.url()).pathname;
    const index = intended.findIndex((x) => x.path === path && x.status === r.status());
    if (index >= 0) { intended.splice(index, 1); observedFaults.push({ path, status: r.status() }); }
    else errors.push(`HTTP ${r.status()}: ${path}`);
  });
  return {
    expectResponse(path: string, status: number) { intended.push({ path, status }); },
    async assertClean() {
      try {
      // Drain browser events before evaluating the accumulated diagnostics.
      await page.evaluate(() => undefined);
      const remaining = [...observedFaults];
      for (const diagnostic of httpDiagnostics) {
        const index = remaining.findIndex((fault) => fault.path === diagnostic.path && fault.status === diagnostic.status);
        expect(index, `unexpected browser HTTP diagnostic: ${JSON.stringify(diagnostic)}`).toBeGreaterThanOrEqual(0);
        remaining.splice(index, 1);
      }
      expect(intended, 'expected fault responses were never observed').toEqual([]);
      expect(errors).toEqual([]);
      } finally {
        // Attribute a diagnostic once, to its own route/scenario.
        errors.length = httpDiagnostics.length = observedFaults.length = intended.length = 0;
      }
    },
  };
}

async function settled(page: Page, timeout?: number) {
  await expect(page.getByRole('main')).toBeVisible({ timeout });
  // The shell can arrive before streamed route content. A visible empty shell
  // is not a loaded page and gives axe false missing-heading results.
  await expect(page.getByRole('main')).toHaveText(/\S/, { useInnerText: true, timeout });
  await expect(page.locator('main h1, main [role="alert"]').first()).toBeVisible({ timeout });
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout });
  // A condition in the browser, not a timing delay: all local font faces loaded.
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await expect(page.locator('dialog[open] [data-state="loading"]')).toHaveCount(0);
  await expect.poll(() => pendingRequests.get(page)?.size ?? 0, { timeout }).toBe(0);
}

async function overflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 'horizontal overflow').toBeLessThanOrEqual(0);
}
async function axe(page: Page) {
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.map((v) => ({ id: v.id, impact: v.impact, targets: v.nodes.map((n) => n.target) }))).toEqual([]);
}

// Inventory includes negative tabindex and ARIA controls so removing an element
// from Tab order cannot make the check pass. Radio groups use the selected radio.
async function keyboard(page: Page) {
  const inventory = await page.evaluate(() => {
    const scope = document.querySelector('dialog[open]') ?? document;
    const elements = Array.from(scope.querySelectorAll<HTMLElement>(
      'a[href],button,input:not([type="hidden"]),textarea,select,summary,[tabindex],[role="button"],[role="link"],[role="checkbox"],[role="tab"],[contenteditable="true"]',
    )).filter((el) => !el.matches(':disabled,[aria-disabled="true"],main') && el.checkVisibility({ checkVisibilityCSS: true }) && !el.closest('[inert]'));
    const radios = elements.filter((el) => el instanceof HTMLInputElement && el.type === 'radio');
    const stops = elements.filter((el) => {
      if (!(el instanceof HTMLInputElement) || el.type !== 'radio' || !el.name) return true;
      const group = radios.filter((r) => (r as HTMLInputElement).name === el.name);
      return el === (group.find((r) => (r as HTMLInputElement).checked) ?? group[0]);
    });
    stops.forEach((el, index) => el.setAttribute('data-sweep-stop', String(index)));
    return stops.map((el, index) => ({ index, label: (el.getAttribute('aria-label') ?? el.textContent ?? el.tagName).trim().slice(0, 90), tabIndex: el.tabIndex }));
  });
  expect(inventory.filter((el) => el.tabIndex < 0), 'interactive elements removed from Tab order').toEqual([]);
  expect(inventory.filter((el) => el.tabIndex > 0), 'positive tabindex changes reading order').toEqual([]);
  if (!inventory.length) return; // Login may have no configured sign-in provider.
  // Start at a known real stop, then traverse one full cycle with actual Tab keys.
  const first = page.locator('[data-sweep-stop="0"]');
  await first.focus();
  const seen = new Set<number>();
  for (let n = 0; n <= inventory.length; n++) {
    const focus = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null; // browser chrome at wraparound
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return { index: Number(el.getAttribute('data-sweep-stop') ?? -1),
        visible: el.checkVisibility({ checkVisibilityCSS: true }) && rect.width > 0 && rect.height > 0,
        ring: (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) || style.boxShadow !== 'none' };
    });
    if (focus && focus.index >= 0) {
      expect(focus.visible, `invisible focus: ${inventory[focus.index]?.label}`).toBe(true);
      // focus-visible applies after keyboard input (the first programmatic focus
      // is only our starting marker). Require a visible CSS focus indicator.
      if (n > 0) expect(focus.ring, `missing focus indicator: ${inventory[focus.index]?.label}`).toBe(true);
      seen.add(focus.index);
    }
    await page.keyboard.press('Tab');
  }
  expect(inventory.filter((el) => !seen.has(el.index)), 'unreachable controls / keyboard trap').toEqual([]);
  await page.keyboard.press('Shift+Tab');
  await page.locator('[data-sweep-stop]').evaluateAll((els) => els.forEach((el) => el.removeAttribute('data-sweep-stop')));
}

async function escapeDialog(page: Page, timeout?: number) {
  const dialog = page.locator('dialog[open]');
  if (await dialog.count()) {
    const closesPanel = await dialog.first().getAttribute('aria-labelledby') === 'panel-title';
    const previousURL = page.url();
    prepareNavigation(page);
    try {
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0, { timeout });
      if (closesPanel) await expect(page).not.toHaveURL(previousURL, { timeout });
    } finally { navigationActive.delete(page); }
  }
}

async function designatedState(page: Page, kind: string, timeout?: number) {
  await expect(page.locator(`[data-state="${kind}"]`).first()).toBeVisible({ timeout });
  expect(await page.locator('[data-state="empty"], [data-state="no_match"]').count(), 'fault disguised as empty data').toBe(0);
}

async function noWrites(page: Page) {
  expect(await page.locator('main button:not(:disabled)').filter({ hasText: /save|approve|promote|create|send|take .*text|link this/i }).count(), 'unsafe write control during fault').toBe(0);
}

async function guardedDraft(page: Page, draft: string, timeout?: number) {
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Next up', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Leave without saving?' });
  await expect(dialog).toBeVisible({ timeout });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/review\/SYN-L001$/);
  await expect(page.getByLabel(/Post copy/)).toHaveValue(draft);
}

function random(seed: number) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 0x100000000; };
}
async function noDeadEnd(page: Page) {
  const screen = await page.evaluate(() => ({
    exits: [...document.querySelectorAll<HTMLElement>('a[href^="/"],a[href="#main"],button,summary')]
      .filter((el) => el.checkVisibility({ checkVisibilityCSS: true }) && !el.matches(':disabled,[aria-disabled="true"]') && !el.closest('[inert]')).length,
    main: document.querySelector('main')?.innerText.trim() ?? '',
    login: location.pathname === '/login' && [...document.querySelectorAll('h1')].some((el) => el.textContent === 'Sign in to Content Studio'),
  }));
  // Login is an intentional terminal boundary; its heading explains recovery.
  expect(screen.exits > 0 || screen.login, 'dead-end screen').toBe(true);
  expect(screen.main, 'blank main region').not.toBe('');
}

async function monkey(page: Page, route: string) {
  const rng = random(SEED + [...route].reduce((sum, c) => sum + c.charCodeAt(0), 0));
  const actions: string[] = [];
  // Eight actions per route (well below 60). Rebuild the stable DOM-order safe
  // inventory after every action; never click save/approve/delete/sign-out/etc.
  for (let n = 0; n < 8; n++) {
    const summaries = page.locator('summary').filter({ visible: true });
    const searches = page.locator('input[type="search"]').filter({ visible: true });
    const links = page.locator('a[href]').filter({ visible: true });
    const safeLinks = await links.evaluateAll((els, routes) => els.map((el, index) => {
      const href = el.getAttribute('href') ?? '';
      return { index, href };
    }).filter((el) => (routes as string[]).includes(el.href)), [...ROUTES].filter((r) => r !== '/login'));
    const choices = ['Tab', 'Shift+Tab', 'Escape', ...(await summaries.count() ? ['disclose'] : []),
      ...(await searches.count() ? ['search'] : []), ...(safeLinks.length ? ['navigate'] : [])];
    const action = choices[Math.floor(rng() * choices.length)]!;
    if (action === 'disclose') {
      const index = Math.floor(rng() * await summaries.count());
      await summaries.nth(index).focus();
      await page.keyboard.press('Enter');
      actions.push(`disclose:${index}`);
    } else if (action === 'search') {
      await searches.first().fill(n % 2 ? '' : 'synthetic');
      await expect(page.locator('main [aria-live]').filter({ hasText: /^Searching/ })).toHaveCount(0);
      await settled(page);
      actions.push(`search:${n % 2 ? '' : 'synthetic'}`);
    } else if (action === 'navigate') {
      const target = safeLinks[Math.floor(rng() * safeLinks.length)]!;
      prepareNavigation(page);
      try {
        await links.nth(target.index).click();
        await expect(page).toHaveURL(new URL(target.href, page.url()).href);
        await settled(page);
      } finally { navigationActive.delete(page); }
      actions.push(`navigate:${target.href}`);
    } else {
      await page.keyboard.press(action);
      actions.push(action);
    }
    await noDeadEnd(page);
    expect(await page.getByRole('dialog', { name: 'Leave without saving?' }).count(), 'safe pass unexpectedly dirtied data').toBe(0);
  }
  return actions;
}

function report(page: Page, info: TestInfo, role: Role) {
  const rows: Row[] = [];
  return {
    async check(route: string, check: string, action: () => Promise<unknown>, rowRole: Role = role) {
      try {
        const detail = await action();
        rows.push({ route, width: page.viewportSize()!.width, role: rowRole, check, result: 'pass',
          ...(detail ? { evidence: JSON.stringify(detail) } : {}) });
      } catch (error) {
        rows.push({ route, width: page.viewportSize()!.width, role: rowRole, check, result: 'fail', evidence: String(error) });
        // Preserve findings even if a later timeout or disk/process failure
        // prevents the test's final attachment from being written.
        await writeFile(info.outputPath('partial-sweep.json'), JSON.stringify({ seed: SEED, rows }, null, 2));
        await page.screenshot({ path: info.outputPath(`finding-${rows.length}.png`), fullPage: true });
      }
    },
    async finish() {
      await writeFile(info.outputPath('sweep.json'), JSON.stringify({ seed: SEED, rows }, null, 2));
      await info.attach('sweep', { path: info.outputPath('sweep.json'), contentType: 'application/json' });
      expect(rows.filter((r) => r.result === 'fail').map((r) => `${r.route} | ${r.check}: ${r.evidence?.slice(0, 160)}`), 'See attached sweep.json for full findings').toEqual([]);
    },
  };
}

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

const FAULTS = [
  ['AUTH_REQUIRED', 'forbidden'], ['FORBIDDEN', 'forbidden'],
  ['CONFIG_MISSING', 'not_configured'], ['NOT_FOUND', 'blocked'],
  ['RATE_LIMITED', 'rate_limited'], ['PROVIDER_UNAVAILABLE', 'provider_error'],
  ['SCHEMA_DRIFT', 'blocked'], ['STALE_READ', 'conflict'],
  ['CONFLICT', 'conflict'], ['GATE_BLOCKED', 'blocked'],
  ['AMBIGUOUS_MATCH', 'conflict'], ['PARTIAL_FAILURE', 'partial_failure'],
  ['VALIDATION_FAILED', 'blocked'], ['UNKNOWN', 'provider_error'],
] as const;
const SHEET_READERS = [
  ['/', 'Content Schedule'], ['/backlog', 'Content Library'],
  ['/backlog?view=ideas', 'Content Queue'],
  ['/review', 'Content Library'], ['/ready', 'Content Library'],
  ['/schedule', 'Content Schedule'], ['/schedule?view=month&month=2026-10', 'Content Schedule'],
  ['/schedule?view=list&week=2026-10-01', 'Content Schedule'], ['/published', 'Content Schedule'],
  ['/visuals', 'Content Library'], ['/review/SYN-L001', 'Content Library'],
  ['/visuals/SYN-L012', 'Content Library'], ['/published/2026-10-01-MAIN-X', 'Content Schedule'],
  ['/schedule/2026-10-02-MAIN-X', 'Content Schedule'],
  ['/schedule/2026-10-03-MAIN-X/adapt', 'Content Schedule'],
  ['/ready/SYN-L005/promote?slot=2026-10-01-MAIN-LI', 'Content Library'],
] as const;

test('sweep inventory matches navigation and injectable fault vocabulary', async ({ page }, info) => {
  const coverage = report(page, info, 'owner');
  try {
    await coverage.check('(coverage contract)', 'inventory', async () => {
      const shell = await readFile('src/components/app-shell.tsx', 'utf8');
      const nav = [...shell.matchAll(/href: '([^']+)'/g)].map((match) => match[1]);
      expect(nav.length).toBeGreaterThan(0);
      expect(nav.filter((route) => !ROUTES.some((covered) => covered === route)), 'new nav route needs sweep coverage').toEqual([]);
      expect(FAULTS.map(([code]) => code).sort()).toEqual([...ERROR_CODES].sort());
    });
  } finally { await coverage.finish(); }
});

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
          if (route.startsWith('/review')) await expect(page.getByLabel(/Post copy/)).toBeEditable();
          else await expect(page.getByTestId('zh-proposal')).toHaveCount(0);
          await monitor.assertClean();
        });
      }
  } finally { await coverage.finish(); }
});
}

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
