import { expect, test, type Page } from '@playwright/test';

/**
 * #242: in-editor undo, caret and scroll kept on toolbar edits, the one-click AI
 * check with hooks going to the top of the text, and the clearer Delete post.
 */
test.beforeEach(async ({ page }) => {
  expect((await page.request.post('/api/test-control', { data: { kind: 'reset' } })).status()).toBe(200);
  expect((await page.request.post('/api/test-auth', { data: { as: 'owner' } })).status()).toBe(200);
});

const openPanel = async (page: Page, id: string) => {
  await page.goto(`/backlog?post=${id}`);
  return page.getByRole('dialog');
};

test('Ctrl+Z, Shift+Ctrl+Z and the Undo and Redo buttons walk back through a toolbar edit', async ({ page }) => {
  const panel = await openPanel(page, 'SYN-L001');
  const box = panel.getByLabel(/Post copy/);
  const typed = 'One\ntwo\n\nThree\nfour';
  await box.fill(typed);
  const undo = panel.getByRole('button', { name: 'Undo edit' });
  const redo = panel.getByRole('button', { name: 'Redo edit' });
  expect((await undo.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await panel.getByRole('button', { name: 'Fewer line breaks' }).click();
  await expect(box).toHaveValue('One two\n\nThree four');
  await expect(box).toBeFocused();
  await page.keyboard.press('Control+z');
  await expect(box).toHaveValue(typed);
  await page.keyboard.press('Control+Shift+z');
  await expect(box).toHaveValue('One two\n\nThree four');
  await undo.click();
  await expect(box).toHaveValue(typed);
  await expect(redo).toBeEnabled();
  await redo.click();
  await expect(box).toHaveValue('One two\n\nThree four');
});

test('a toolbar edit keeps the selection on the same lines and does not scroll the box', async ({ page }) => {
  const panel = await openPanel(page, 'SYN-L001');
  const box = panel.getByLabel(/Post copy/);
  const lines = Array.from({ length: 40 }, (_, i) => `Line ${i + 1}`).join('\n');
  await box.fill(lines);
  const before = await box.evaluate((el: HTMLTextAreaElement) => {
    const start = el.value.indexOf('Line 30');
    el.focus();
    el.setSelectionRange(start, el.value.indexOf('Line 32') + 'Line 32'.length);
    el.scrollTop = 200;
    return { top: el.scrollTop };
  });
  await panel.getByRole('button', { name: 'Bulleted list' }).click();
  const after = await box.evaluate((el: HTMLTextAreaElement) => ({
    top: el.scrollTop, selected: el.value.slice(el.selectionStart, el.selectionEnd),
  }));
  expect(after.selected).toBe('• Line 30\n• Line 31\n• Line 32');
  expect(after.top).toBe(before.top);
});

test('Check with AI gives the English result, an image verdict and three hooks; a hook goes to the top and saves with the text', async ({ page }) => {
  // SYN-L005 has a saveable Markdown section; SYN-L003's section is deliberately ambiguous.
  expect((await page.request.post('/api/test-control', { data: { kind: 'sheet_edit', libraryId: 'SYN-L005', header: 'Visual Source', value: '' } })).status()).toBe(200);
  const panel = await openPanel(page, 'SYN-L005');
  const box = panel.getByLabel(/Post copy/);
  const button = panel.getByRole('button', { name: /Check with AI/ });
  // Above the text box, on the left.
  const buttonBox = (await button.boundingBox())!;
  const textBox = (await box.boundingBox())!;
  expect(buttonBox.y).toBeLessThan(textBox.y);
  expect(buttonBox.x).toBeLessThanOrEqual(textBox.x + 24);
  await button.click();
  await expect(panel.locator('[data-image-verdict]')).toBeVisible();
  await expect(panel.locator('[data-qa-chips]')).toBeVisible();
  const options = panel.getByRole('list', { name: 'Hook options' }).getByRole('listitem');
  await expect(options).toHaveCount(3);
  const hook = (await options.first().locator('p.copy').innerText()).trim();
  await options.first().getByRole('button', { name: /Use hook option 1/ }).click();
  expect(((await box.inputValue()).split('\n')[0] ?? '').trim()).toBe(hook);
  await expect(panel.getByLabel('Chosen hook')).toHaveValue(hook);
  await page.keyboard.press('Control+z');
  await expect(box).not.toHaveValue(new RegExp(`^${hook.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  await panel.getByRole('button', { name: 'Redo edit' }).click();
  expect(((await box.inputValue()).split('\n')[0] ?? '').trim()).toBe(hook);
  await panel.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(panel.getByText(/^Saved/).first()).toBeVisible();
  const saved = await (await page.request.get('/api/library/SYN-L005/editor')).json();
  expect(saved.model.sheet.hook).toBe(hook);
  expect(saved.model.sheet.draft.split('\n')[0].trim()).toBe(hook);
});

test.describe('Delete post', () => {
  test.skip(process.env.CS_E2E_CONTENT_STORE !== 'db', 'Deletion uses the database authority.');

  test('asks first, shows the deleted notice with a large Undo and a countdown, and Undo restores', async ({ page }) => {
    const panel = await openPanel(page, 'SYN-L001');
    const open = panel.getByRole('button', { name: 'Delete post', exact: true });
    expect((await open.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await open.click();
    const group = panel.getByRole('group', { name: 'Confirm delete' });
    await expect(group).toBeVisible();
    await expect(group.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await group.getByRole('button', { name: 'Cancel' }).click();
    await expect(group).toHaveCount(0);
    await open.click();
    await panel.getByRole('button', { name: 'Delete', exact: true }).click();
    const toasts = page.getByRole('status', { name: 'Notifications' });
    await expect(toasts).toContainText('Post deleted');
    await expect(toasts).toContainText(/\d+ s left/);
    const undo = toasts.getByRole('button', { name: 'Undo', exact: true });
    expect((await undo.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(panel).not.toBeVisible();
    await undo.click();
    await expect(toasts).toContainText('Post restored.');
  });
});
