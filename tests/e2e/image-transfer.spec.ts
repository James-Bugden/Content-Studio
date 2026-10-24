import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const PNG = [137, 80, 78, 71, 13, 10, 26, 10];
const asset = 'SYNTH_asset_researched_range_r02.png';

async function control(page: Page, data: Record<string, unknown>) {
  expect((await page.request.post('/api/test-control', { data })).status()).toBe(200);
}

test.beforeEach(async ({ page }) => {
  await control(page, { kind: 'reset' });
  expect((await page.request.post('/api/test-auth', { data: { as: 'owner' } })).status()).toBe(200);
});

test('VIS/SEC: native drag has only a PNG File; cross-frame receipt is a known Chromium limitation', async ({ page }) => {
  await page.goto('/visuals/SYN-L012');
  const image = page.getByRole('region', { name: 'Full-size preview (scrolls)', exact: true }).locator('img');
  await expect(image.locator('..')).toHaveAttribute('draggable', 'true');
  await page.route('**/__image-dropzone', route => route.fulfill({ contentType: 'text/html', path: 'tests/e2e/fixtures/image-dropzone.html' }));
  await page.evaluate(() => {
    const frame = document.createElement('iframe');
    frame.src = '/__image-dropzone';
    frame.title = 'Test image receiver';
    frame.style.cssText = 'position:fixed;bottom:0;left:0;width:280px;height:180px;z-index:9999;background:white';
    document.body.append(frame);
  });
  const target = page.frameLocator('iframe[title="Test image receiver"]');
  await expect(target.locator('#drop')).toBeVisible();
  await image.evaluate(img => {
    img.ownerDocument.addEventListener('dragstart', event => {
      // Document bubbling runs after React's root listener, while the native
      // store is still readable in dragstart (not after its protected mode).
        const dt = (event as DragEvent).dataTransfer!;
        document.documentElement.dataset.drag = JSON.stringify({
          types: [...dt.types],
          items: [...dt.items].map(item => ({ kind: item.kind, type: item.type, name: item.getAsFile()?.name })),
          strings: [...dt.types].filter(type => type !== 'Files').map(type => dt.getData(type)),
        });
    }, { once: true });
  });
  // Real mouse drag: exercise Chromium's native data store and actual drop.
  await image.dragTo(target.locator('#drop'), { sourcePosition: { x: 100, y: 100 } });
  const drag = JSON.parse((await page.locator('html').getAttribute('data-drag'))!);
  expect(drag.types).toEqual(['Files']);
  expect(drag.strings).toEqual([]);
  expect(drag.items).toEqual([{ kind: 'file', type: 'image/png', name: 'researched-range-1.png' }]);
  expect(JSON.stringify(drag)).not.toMatch(/https?:|blob:|data:|\/api\/|drive\.google|token|bearer/i);
  await expect(target.locator('#result')).not.toBeEmpty();
  const received = JSON.parse((await target.locator('#result').textContent())!);
  // Keep the actual native acceptance assertion red/expected-failing, rather
  // than claiming a dispatched event proves cross-site uploads work. If Chrome
  // starts forwarding generated files this becomes an unexpected pass.
  test.fail(true, 'Chromium strips the generated File during native cross-frame drop. Copy/Download are required; T4 external composers remain unverified.');
  expect(received).toEqual([expect.objectContaining({ name: 'researched-range-1.png', type: 'image/png', isFile: true, signature: PNG })]);
  expect(received[0].size).toBeGreaterThan(1000);
});

test('VIS: controlled dropzone event receives the actual prepared PNG File (not native cross-site proof)', async ({ page }) => {
  await page.goto('/visuals/SYN-L012');
  const image = page.getByRole('region', { name: 'Full-size preview (scrolls)', exact: true }).locator('img');
  await expect(image.locator('..')).toHaveAttribute('draggable', 'true');
  const transfer = await image.evaluateHandle(img => {
    const dataTransfer = new DataTransfer();
    img.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
    return dataTransfer;
  });
  // setContent keeps this document's realm and File, but replaces the app with
  // the test-only receiving page. This is explicitly a controlled-event test.
  await page.setContent(await readFile('tests/e2e/fixtures/image-dropzone.html', 'utf8'));
  await page.locator('#drop').dispatchEvent('drop', { dataTransfer: transfer });
  await expect(page.locator('#result')).not.toBeEmpty();
  const received = JSON.parse((await page.locator('#result').textContent())!);
  expect(received).toEqual([expect.objectContaining({ name: 'researched-range-1.png', type: 'image/png', isFile: true, signature: PNG })]);
  expect(received[0].size).toBeGreaterThan(1000);
  await transfer.dispose();
});

test('VIS: real clipboard image/png, PNG download and keyboard actions', async ({ page, context }, info) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/visuals/SYN-L012');
  const actions = page.getByRole('region', { name: 'Full-size preview (scrolls)', exact: true }).locator('..').getByRole('group', { name: 'Image actions' });
  const copy = actions.getByRole('button', { name: 'Copy image', exact: true });
  await expect(copy).toBeEnabled();
  await copy.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Image copied. Paste it into the composer.').first()).toBeVisible();
  const clipboard = await page.evaluate(async () => {
    const entries = await navigator.clipboard.read();
    const png = await entries[0]!.getType('image/png');
    return { types: entries[0]!.types, bytes: [...new Uint8Array(await png.arrayBuffer()).slice(0, 8)] };
  });
  expect(clipboard.types).toContain('image/png');
  expect(clipboard.bytes).toEqual(PNG);
  const downloadEvent = page.waitForEvent('download');
  await actions.getByRole('button', { name: 'Download', exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('researched-range-1.png');
  const bytes = await readFile((await download.path())!);
  expect([...bytes.subarray(0, 8)]).toEqual(PNG);
  // SVG design size survives rasterisation (PNG IHDR width/height).
  expect(bytes.readUInt32BE(16)).toBe(1080);
  expect(bytes.readUInt32BE(20)).toBe(1080);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(results.violations).toEqual([]);
  await page.getByRole('region', { name: 'Full-size preview (scrolls)', exact: true }).locator('..').screenshot({ path: info.outputPath('image-actions.png') });
});

test('finished asset in the post panel downloads PNG; Share is file-only when supported', async ({ page }) => {
  await control(page, { kind: 'sheet_edit', libraryId: 'SYN-L009', header: 'Image File', value: asset });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { value: ({ files }: ShareData) => files?.[0]?.type === 'image/png' });
    Object.defineProperty(navigator, 'share', { value: async (data: ShareData) => {
      document.documentElement.dataset.share = JSON.stringify({ keys: Object.keys(data), name: data.files?.[0]?.name, type: data.files?.[0]?.type });
    } });
  });
  await page.goto('/review?post=SYN-L009');
  const preview = page.getByRole('article', { name: 'Preview on LinkedIn' });
  await expect(preview.getByRole('button', { name: 'Download', exact: true })).toBeEnabled();
  await expect(preview.locator('img').locator('..')).toHaveAttribute('draggable', 'true');
  const downloadEvent = page.waitForEvent('download');
  await preview.getByRole('button', { name: 'Download', exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('syn-l009-1.png');
  expect([...(await readFile((await download.path())!)).subarray(0, 8)]).toEqual(PNG);
  await preview.getByRole('button', { name: 'Share', exact: true }).click();
  expect(JSON.parse((await page.locator('html').getAttribute('data-share'))!)).toEqual({ keys: ['files'], name: 'syn-l009-1.png', type: 'image/png' });
});

test('Published uses its Schedule image and the new route keeps authentication', async ({ page }) => {
  const id = '2026-10-01-MAIN-X';
  await control(page, { kind: 'schedule_edit', contentId: id, header: 'Image File', value: asset });
  await page.goto(`/published/${id}`);
  await expect(page.getByRole('button', { name: 'Download', exact: true })).toBeEnabled();
  expect((await page.request.get(`/api/schedule/${id}/asset`)).headers()['content-type']).toBe('image/png');
  await page.request.post('/api/test-auth', { data: { as: 'none' } });
  expect((await page.request.get(`/api/schedule/${id}/asset`)).status()).toBe(401);
});
