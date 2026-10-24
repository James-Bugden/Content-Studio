import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('local Inter loads all app weights with the existing CSP', async ({ page }) => {
  const fontRequests: string[] = [];
  const cspErrors: string[] = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'font') fontRequests.push(request.url());
  });
  page.on('console', (message) => {
    if (/content security policy/i.test(message.text())) cspErrors.push(message.text());
  });
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.abort());
  const response = await page.goto('/dev/states');
  expect(response?.headers()['content-security-policy']).toContain("font-src 'self' data:");

  const fonts = await page.evaluate(async () => {
    const family = (getComputedStyle(document.body).fontFamily.split(',')[0] ?? '').trim();
    const weights = ['400', '500', '600'];
    const loaded = await Promise.all(weights.map(async (weight) => {
      const faces = await document.fonts.load(`${weight} 16px ${family}`, 'Content Studio');
      return faces.map((face) => ({ weight: face.weight, status: face.status, display: face.display }));
    }));
    return { family, loaded, variable: getComputedStyle(document.documentElement).getPropertyValue('--font-sans-polished') };
  });
  expect(fonts.family).toContain('inter');
  expect(fonts.variable).toContain('inter');
  expect(fonts.loaded).toEqual(['400', '500', '600'].map((weight) => [{ weight, status: 'loaded', display: 'swap' }]));
  expect(new Set(fontRequests).size).toBe(3);
  expect(fontRequests.every((url) => new URL(url).origin === new URL(page.url()).origin)).toBe(true);
  expect(cspErrors).toEqual([]);

  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(axe.violations).toEqual([]);
});
