import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Request, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const SEED = 163;
export const ROUTES = [
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
export async function navigate(page: Page, route: string) {
  // Readiness belongs to the new view. Error listeners still observe cancelled
  // or failed old reads, but a superseded response cannot hold its successor busy.
  pendingRequests.get(page)?.clear();
  return page.goto(route);
}

export async function control(page: Page, data: Record<string, unknown>) {
  expect((await page.request.post('/api/test-control', { data })).status()).toBe(200);
}
export async function signIn(page: Page, role: Role) {
  expect((await page.request.post('/api/test-auth', { data: { as: role } })).status()).toBe(200);
}

export function observe(page: Page) {
  const errors: string[] = [];
  const intended: ExpectedResponse[] = [];
  // Only Chromium's generic HTTP diagnostic for an EXACT explicitly expected
  // fault response is allowed. It must match an observed response below;
  // hydration diagnostics and application console errors are never allowed.
  const httpDiagnostics: ExpectedResponse[] = [];
  const observedFaults: ExpectedResponse[] = [];
  const pending = new Set<Request>();
  pendingRequests.set(page, pending);
  const rsc = (r: Request) => r.method() === 'GET' && r.headers().rsc === '1' && new URL(r.url()).searchParams.has('_rsc');
  const studioPage = (url: string) => {
    const path = new URL(url).pathname;
    return ROUTES.some((route) => route.split('?')[0] === path) ||
      /^\/(review|visuals|published|schedule)\/[A-Za-z0-9-]+(?:\/adapt)?$/.test(path) || /^\/ready\/[A-Za-z0-9-]+\/promote$/.test(path);
  };
  page.on('request', (r) => {
    if (!sameOrigin(r.url())) return;
    if (!rsc(r) && ['fetch', 'xhr'].includes(r.resourceType())) pending.add(r);
  });
  page.on('requestfinished', (r) => pending.delete(r));
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
    // Next deliberately cancels obsolete route streams, including after its
    // panel-close transition commits. This exception is ONLY aborted fetches of
    // known studio page RSC; documents, APIs and other failure reasons still fail.
    if (sameOrigin(r.url()) && r.resourceType() === 'fetch' && rsc(r) && studioPage(r.url()) && r.failure()?.errorText === 'net::ERR_ABORTED') return;
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

export async function settled(page: Page, timeout?: number) {
  // Batch the same readiness conditions into one browser round trip. The shell
  // can precede streamed route content; an empty shell is not a loaded page.
  await expect.poll(async () => ({ ...await page.evaluate(() => {
    const main = document.querySelector<HTMLElement>('main,[role="main"]');
    const visible = (el: Element) => el.checkVisibility({ checkVisibilityCSS: true }) && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0;
    return { main: !!main && visible(main), content: !!main?.innerText.trim(),
      titleOrState: !!main && [...main.querySelectorAll('h1,[role="alert"]')].some(visible),
      busy: document.querySelectorAll('[aria-busy="true"]').length,
      dialogLoading: document.querySelectorAll('dialog[open] [data-state="loading"]').length,
      fonts: document.fonts.status };
  }), pending: pendingRequests.get(page)?.size ?? 0 }), { timeout }).toEqual({ main: true, content: true, titleOrState: true, busy: 0, dialogLoading: 0, fonts: 'loaded', pending: 0 });
}

export async function overflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 'horizontal overflow').toBeLessThanOrEqual(0);
}
export async function axe(page: Page) {
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.map((v) => ({ id: v.id, impact: v.impact, targets: v.nodes.map((n) => n.target) }))).toEqual([]);
}

// Inventory includes negative tabindex and ARIA controls so removing an element
// from Tab order cannot make the check pass. Radio groups use the selected radio.
type FocusSample = { index: number; visible: boolean; ring: boolean };
type KeyboardProbe = { samples: FocusSample[]; record: () => void };
type KeyboardWindow = Window & { __csSweepKeyboard?: KeyboardProbe };
export async function keyboard(page: Page) {
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
  await page.evaluate(() => {
    const probe: KeyboardProbe = { samples: [], record: () => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return; // browser chrome at wraparound
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      probe.samples.push({ index: Number(el.getAttribute('data-sweep-stop') ?? -1),
        visible: el.checkVisibility({ checkVisibilityCSS: true }) && rect.width > 0 && rect.height > 0,
        ring: (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) || style.boxShadow !== 'none' });
    } };
    (window as KeyboardWindow).__csSweepKeyboard = probe;
    probe.record();
    // Sample each actual focus change in the browser, instead of paying an
    // extra automation round trip for every Tab. Assertions stay identical.
    document.addEventListener('focusin', probe.record);
  });
  for (let n = 0; n <= inventory.length; n++) await page.keyboard.press('Tab');
  const samples = await page.evaluate(() => {
    const target = window as KeyboardWindow;
    const probe = target.__csSweepKeyboard!;
    document.removeEventListener('focusin', probe.record);
    delete target.__csSweepKeyboard;
    return probe.samples;
  });
  const seen = new Set<number>();
  for (const [n, focus] of samples.entries()) {
    if (focus.index >= 0) {
      expect(focus.visible, `invisible focus: ${inventory[focus.index]?.label}`).toBe(true);
      // focus-visible applies after keyboard input (the first programmatic focus
      // is only our starting marker). Require a visible CSS focus indicator.
      if (n > 0) expect(focus.ring, `missing focus indicator: ${inventory[focus.index]?.label}`).toBe(true);
      seen.add(focus.index);
    }
  }
  expect(inventory.filter((el) => !seen.has(el.index)), 'unreachable controls / keyboard trap').toEqual([]);
  await page.keyboard.press('Shift+Tab');
  await page.locator('[data-sweep-stop]').evaluateAll((els) => els.forEach((el) => el.removeAttribute('data-sweep-stop')));
}

export async function escapeDialog(page: Page, timeout?: number) {
  const dialog = page.locator('dialog[open]');
  if (await dialog.count()) {
    const closesPanel = await dialog.first().getAttribute('aria-labelledby') === 'panel-title';
    const previousURL = page.url();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0, { timeout });
    if (closesPanel) {
      await expect(page).not.toHaveURL(previousURL, { timeout });
      pendingRequests.get(page)?.clear();
    }
  }
}

export async function designatedState(page: Page, kind: string, timeout?: number) {
  await expect(page.locator(`[data-state="${kind}"]`).first()).toBeVisible({ timeout });
}

export async function noWrites(page: Page) {
  // Use accessible names (including icon buttons and submit inputs), across the
  // whole page: dialogs/portals need not be descendants of main. Ordinary links
  // such as Schedule, Published and read-retry navigation are safe to follow;
  // links with role=button are actions and must satisfy the same guard.
  const name = /^(?:confirm\s+)?(?:save|approve|promote|create|send|publish|delete|schedule|discard|retry|remove|archive|upload|import|update|apply|sync|unlink|replace|record|take\s+.*text|link this)\b/i;
  const controls = page.getByRole('button', { name }).or(page.getByRole('menuitem', { name }));
  for (const control of await controls.all()) {
    if (await control.isVisible()) expect(await control.isEnabled(), 'unsafe write control during fault').toBe(false);
  }
}

export async function guardedDraft(page: Page, draft: string, timeout?: number) {
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
export async function noDeadEnd(page: Page) {
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

export async function monkey(page: Page, route: string) {
  const rng = random(SEED + [...route].reduce((sum, c) => sum + c.charCodeAt(0), 0));
  const actions: string[] = [];
  // Eight actions per route (well below 60). Rebuild the stable DOM-order safe
  // inventory after every action; never click save/approve/delete/sign-out/etc.
  for (let n = 0; n < 8; n++) {
    const summaries = page.locator('summary').filter({ visible: true });
    const searches = page.locator('input[type="search"]').filter({ visible: true });
    const inventory = await page.evaluate((routes) => {
      const visible = (el: Element) => el.checkVisibility({ checkVisibilityCSS: true });
      document.querySelectorAll('[data-sweep-safe-link]').forEach((el) => el.removeAttribute('data-sweep-safe-link'));
      const links = [...document.querySelectorAll<HTMLAnchorElement>('a[href]')].filter((el) => visible(el) && routes.includes(el.getAttribute('href') ?? ''));
      links.forEach((el, index) => el.setAttribute('data-sweep-safe-link', String(index)));
      return { summaries: [...document.querySelectorAll('summary')].filter(visible).length,
        searches: [...document.querySelectorAll('input[type="search"]')].filter(visible).length,
        links: links.map((el, index) => ({ index, href: el.getAttribute('href')! })) };
    }, [...ROUTES].filter((r) => r !== '/login') as string[]);
    const choices = ['Tab', 'Shift+Tab', 'Escape', ...(inventory.summaries ? ['disclose'] : []),
      ...(inventory.searches ? ['search'] : []), ...(inventory.links.length ? ['navigate'] : [])];
    const action = choices[Math.floor(rng() * choices.length)]!;
    if (action === 'disclose') {
      const index = Math.floor(rng() * inventory.summaries);
      await summaries.nth(index).press('Enter');
      actions.push(`disclose:${index}`);
    } else if (action === 'search') {
      await searches.first().fill(n % 2 ? '' : 'synthetic');
      await expect(page.locator('main [aria-live]').filter({ hasText: /^Searching/ })).toHaveCount(0);
      await settled(page);
      actions.push(`search:${n % 2 ? '' : 'synthetic'}`);
    } else if (action === 'navigate') {
      const target = inventory.links[Math.floor(rng() * inventory.links.length)]!;
      pendingRequests.get(page)?.clear();
      await page.locator(`[data-sweep-safe-link="${target.index}"]`).click();
      await expect(page).toHaveURL(new URL(target.href, page.url()).href);
      await settled(page);
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

export function report(page: Page, info: TestInfo, role: Role) {
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

export const FAULTS = [
  ['AUTH_REQUIRED', 'forbidden'], ['FORBIDDEN', 'forbidden'],
  ['CONFIG_MISSING', 'not_configured'], ['NOT_FOUND', 'blocked'],
  ['RATE_LIMITED', 'rate_limited'], ['PROVIDER_UNAVAILABLE', 'provider_error'],
  ['SCHEMA_DRIFT', 'blocked'], ['STALE_READ', 'conflict'],
  ['CONFLICT', 'conflict'], ['GATE_BLOCKED', 'blocked'],
  ['AMBIGUOUS_MATCH', 'conflict'], ['PARTIAL_FAILURE', 'partial_failure'],
  ['VALIDATION_FAILED', 'blocked'], ['UNKNOWN', 'provider_error'],
] as const;
export const SHEET_READERS = [
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
