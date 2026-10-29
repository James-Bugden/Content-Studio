import { test, expect, type Page } from '@playwright/test';
import { scanAxe } from './support/axe';

/**
 * #245: sources, earlier posts and images in the Replies tool, run at 375 and 1280
 * (the project list in playwright.config.ts) against the fake providers.
 *
 * Everything is synthetic. The fake generator labels its output as an example, the
 * fake image renderer returns a 1x1 PNG, and the in-memory store holds two invented
 * earlier posts, one invented guide and one invented bank image. These journeys
 * prove the wiring and the layout; they say nothing about real model output.
 */

test.beforeEach(async ({ page }) => {
  await page.request.post('/api/replies/test/reset');
  expect((await page.request.post('/api/test-auth', { data: { as: 'owner' } })).status()).toBe(200);
});

const POST_TEXT = 'Does a cover letter actually matter anymore, or is it just something people still write out of habit?';

/** Created through the page's own origin, so the same-origin check sees a real browser request. */
async function seedFact(page: Page, text: string, sensitivity: 'public_safe' | 'private_context_only') {
  await page.goto('/replies');
  await page.evaluate(
    async ({ text: factText, sensitivity: level }) => {
      const headers = { 'content-type': 'application/json' };
      const created = await fetch('/api/replies/facts', {
        method: 'POST',
        headers,
        body: JSON.stringify({ fact_text: factText, tags: ['cover letter'], sensitivity: level }),
      });
      const { id, version } = (await created.json()) as { id: string; version: number };
      await fetch(`/api/replies/facts/${id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ expected_version: version, changes: { approved: true } }),
      });
    },
    { text, sensitivity },
  );
}

/** Resolves once the editor text has reached the server, so the next rewrite sees it. */
function draftSaved(page: Page) {
  return page.waitForResponse((response) => response.url().endsWith('/api/replies/session') && response.request().method() === 'PATCH');
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function analyse(page: Page) {
  await page.goto('/replies');
  await page.getByRole('textbox', { name: /Paste the post or comment/ }).fill(POST_TEXT);
  await page.getByRole('button', { name: 'Get reply ideas' }).click();
  await expect(page.getByRole('button', { name: 'Use this', exact: true })).toHaveCount(3);
}

test.describe('sources under ideas and the editor', () => {
  test.beforeEach(async ({ page }) => {
    await seedFact(page, 'I reviewed several hundred cover letters while hiring.', 'public_safe');
    await seedFact(page, 'A cover letter once got a friend an interview.', 'private_context_only');
  });

  test('the same click that asks for ideas also finds facts, earlier posts and images', async ({ page }) => {
    await analyse(page);

    const panels = page.getByRole('group', { name: /^Used in this reply:/ });
    await expect(panels.first()).toBeVisible();
    // One under each idea, and one under the editor.
    await expect(panels).toHaveCount(4);

    const first = page.getByRole('group', { name: 'Used in this reply: Direct answer' });
    await expect(first.getByText('More suggestions')).toBeVisible();
    await expect(first.getByText('I reviewed several hundred cover letters while hiring.')).toBeVisible();
    // A private fact is offered, with a small tag.
    const privateRow = first.locator('li').filter({ hasText: 'A cover letter once got a friend an interview.' });
    await expect(privateRow.getByText('private')).toBeVisible();
    // An earlier post can be opened or copied, and has no Insert.
    const postRow = first.locator('li').filter({ hasText: 'Example post: open a cover letter with the problem you solved' });
    await expect(postRow.getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/review/LIB-SYN-001');
    await expect(postRow.getByRole('button', { name: 'Copy' })).toBeVisible();
    await expect(postRow.getByRole('button', { name: /insert/i })).toHaveCount(0);

    await noHorizontalScroll(page);
  });

  test('+ asks for a rewrite preview, and only Replace reply changes the editor', async ({ page }) => {
    await analyse(page);
    const first = page.getByRole('group', { name: 'Used in this reply: Direct answer' });
    const editor = page.getByRole('textbox', { name: 'Your reply' });

    await first.getByRole('button', { name: 'Add: A cover letter once got a friend an interview.' }).click();

    // A preview, from the fake provider, and the editor is still empty.
    await expect(page.getByText(/Example rewrite/)).toBeVisible();
    await expect(editor).toHaveValue('');
    await page.getByRole('button', { name: 'Replace reply' }).click();
    await expect(editor).toHaveValue(/Example rewrite/);

    // The editor now draws on what the rewrite was asked to use.
    const editorPanel = page.getByRole('group', { name: 'Used in this reply: Your reply' });
    await expect(editorPanel.getByText('A cover letter once got a friend an interview.')).toBeVisible();

    await noHorizontalScroll(page);
  });

  test('x asks for a rewrite without the source, and Keep my reply discards it', async ({ page }) => {
    await analyse(page);
    const first = page.getByRole('group', { name: 'Used in this reply: Direct answer' });
    const editor = page.getByRole('textbox', { name: 'Your reply' });
    const firstSave = draftSaved(page);
    await page.getByRole('button', { name: 'Use this', exact: true }).first().click();
    await firstSave;
    const before = await editor.inputValue();

    await first.getByRole('button', { name: 'Add: I reviewed several hundred cover letters while hiring.' }).click();
    await expect(page.getByRole('button', { name: 'Keep my reply' })).toBeVisible();
    const secondSave = draftSaved(page);
    await page.getByRole('button', { name: 'Replace reply' }).click();
    await secondSave;

    const editorPanel = page.getByRole('group', { name: 'Used in this reply: Your reply' });
    await editorPanel.getByRole('button', { name: 'Remove: I reviewed several hundred cover letters while hiring.' }).click();
    await expect(page.getByRole('button', { name: 'Keep my reply' })).toBeVisible();
    const during = await editor.inputValue();
    await page.getByRole('button', { name: 'Keep my reply' }).click();

    // Exactly the text that was there, and the fact is still listed as used.
    await expect(editor).toHaveValue(during);
    expect(during).not.toBe(before);
    await expect(editorPanel.getByText('I reviewed several hundred cover letters while hiring.')).toBeVisible();
    await expect(editorPanel.getByRole('button', { name: 'Remove: I reviewed several hundred cover letters while hiring.' })).toBeVisible();
  });

  test('inserting a guide puts its link in the text by the usual convention, and its x removes it', async ({ page }) => {
    await analyse(page);
    const editor = page.getByRole('textbox', { name: 'Your reply' });
    await editor.fill('My own opening line.');

    const editorPanel = page.getByRole('group', { name: 'Used in this reply: Your reply' });
    await editorPanel.getByRole('button', { name: 'Add: Example cover letter guide' }).click();
    await expect(editor).toHaveValue(
      'My own opening line.\n\nI wrote something on this. https://resources.example.com/guides/cover-letters',
    );

    await editorPanel.getByRole('button', { name: 'Remove: Example cover letter guide' }).click();
    await expect(editor).toHaveValue('My own opening line.');
  });

  test('is accessible and fits the viewport', async ({ page }) => {
    await analyse(page);
    await expect(page.getByRole('heading', { name: 'Images you have used' })).toBeVisible();
    const results = await scanAxe(page, ['wcag2a', 'wcag2aa']);
    expect(results.violations).toEqual([]);
    await noHorizontalScroll(page);
  });
});

test.describe('images in a reply', () => {
  test('shows matching images with copy and download, and no way to insert one into the text', async ({ page }) => {
    await analyse(page);
    const section = page.locator('section[aria-labelledby="image-suggestions-heading"]');
    await expect(section.getByText('Example cover letter checklist').first()).toBeVisible();
    await expect(section.getByRole('img', { name: 'An example checklist for a cover letter.' })).toBeVisible();
    await expect(section.getByRole('button', { name: 'Copy image' })).toBeVisible();
    await expect(section.getByRole('button', { name: 'Download' })).toBeVisible();
    await expect(section.getByText('Replies are text.')).toBeVisible();
    // Pixels come from a same-origin route, never from a storage link.
    const source = await section.getByRole('img').first().getAttribute('src');
    expect(source).toMatch(/^\/api\/replies\/images\/[0-9a-f-]+\/file$/);
  });

  test('Create new goes sketch, approve, image, and saves the PNG to the bank', async ({ page }) => {
    await analyse(page);
    const section = page.locator('section[aria-labelledby="image-suggestions-heading"]');
    await section.getByRole('button', { name: 'Create new' }).click();

    await page.getByLabel('What is it called?').fill('Next step diagram');
    await page.getByLabel('What should it show?').fill('Three steps that make the next step clear');
    await page.getByRole('button', { name: 'Make a sketch' }).click();

    await expect(page.getByLabel('Sketch')).toContainText('Name the task');
    // The image cannot be made until that exact sketch is approved.
    await expect(page.getByRole('button', { name: 'Create image' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Approve sketch' }).click();
    await page.getByRole('button', { name: 'Create image' }).click();

    await expect(page.getByText('Saved to your image bank.')).toBeVisible();
    await noHorizontalScroll(page);

    await page.goto('/replies/images');
    await expect(page.getByText('Next step diagram')).toBeVisible();
    await expect(page.getByText('Created', { exact: true })).toBeVisible();
  });
});

test.describe('the Images page', () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1sAAAAASUVORK5CYII=', 'base64');

  test('is next to Facts and Resources in the menu and lists the bank without bytes', async ({ page }) => {
    await page.goto('/replies/images');
    await expect(page.getByRole('navigation', { name: 'Menu' }).getByRole('link', { name: 'Images' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Images', exact: true })).toBeVisible();
    await expect(page.getByText('Example cover letter checklist')).toBeVisible();
    await noHorizontalScroll(page);
  });

  test('adds an image: a suggestion is editable before saving, and a wrong file is refused', async ({ page }) => {
    await page.goto('/replies/images');
    await expect(page.getByText('Drop images here or click to choose')).toBeVisible();

    await page.getByLabel('Image files').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
    await expect(page.getByText('Use a PNG, JPG or WebP image.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Dismiss' }).click();

    await page.getByLabel('Image files').setInputFiles({ name: 'interview-prep.png', mimeType: 'image/png', buffer: png });
    await page.getByLabel(/What does it show/).fill('a one-page interview prep sheet');
    await page.getByRole('button', { name: 'Suggest title, alt text and tags' }).click();
    await expect(page.getByText('Suggestion added. Edit anything before saving.')).toBeVisible();
    await expect(page.getByLabel('Title')).toHaveValue('Example interview prep');

    await page.getByLabel('Title').fill('Interview prep sheet');
    await page.getByLabel('Tags').fill('interview, prep');
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(page.getByText('Saved.')).toBeVisible();
    await expect(page.getByText('Interview prep sheet', { exact: true })).toBeVisible();
    await expect(page.getByText('interview, prep')).toBeVisible();
    await noHorizontalScroll(page);
  });

  test('edits and deletes an image, asking before the delete', async ({ page }) => {
    await page.goto('/replies/images');
    const row = page.locator('li').filter({ hasText: 'Example cover letter checklist' });
    await row.getByRole('button', { name: 'Edit' }).click();
    await page.getByLabel('Title').fill('Renamed checklist');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Renamed checklist')).toBeVisible();

    const renamed = page.locator('li').filter({ hasText: 'Renamed checklist' });
    await renamed.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByText('Delete this image for good?')).toBeVisible();
    await page.getByRole('button', { name: 'Delete image' }).click();
    await expect(page.getByText('Deleted.')).toBeVisible();
    await expect(page.getByText('No images yet.')).toBeVisible();
  });

  test('is accessible', async ({ page }) => {
    await page.goto('/replies/images');
    await page.getByLabel('Image files').setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: png });
    await expect(page.getByLabel('Title')).toBeVisible();
    const results = await scanAxe(page, ['wcag2a', 'wcag2aa']);
    expect(results.violations).toEqual([]);
  });
});
