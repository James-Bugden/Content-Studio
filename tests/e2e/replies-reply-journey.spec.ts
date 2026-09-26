import { test, expect, type Page } from '@playwright/test';

/**
 * Each journey starts from a known store.
 *
 * The in-memory double is a singleton, so without this a test that creates a fact
 * or disables a resource changes the world every later test runs in, and the
 * second viewport project inherits everything the first one did. That passes when
 * a file is run alone and fails in CI, which is the worst way to find out.
 */
test.beforeEach(async ({ request }) => {
  await request.post('/api/replies/test/reset');
});


/**
 * The journey the product exists for (T1).
 *
 * Paste a post, see what you wrote before and what you could share, choose among
 * three ideas, edit, copy, post manually, record the exact text, and have the
 * count move by one.
 *
 * These run against a production build in fake-provider mode with synthetic data.
 * That makes them deterministic and lets them run in public CI with no credentials,
 * and it also bounds what they prove: they are not evidence about the real
 * database's policies, the real clipboard on a real device, or a real model's
 * output. Those belong to the hosted checks in #21.
 */

const SOURCE_POST =
  'Does a cover letter actually matter anymore, or is it just something people still write out of habit?';

async function analyse(page: Page, text = SOURCE_POST) {
  await page.getByRole('textbox', { name: /Paste the post or comment/ }).fill(text);
  await page.getByRole('button', { name: 'Get reply ideas' }).click();
}

test.describe('the reply loop', () => {
  test('goes from a pasted post to a recorded reply and moves the count by one', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/replies');

    const before = await page.getByText(/^LinkedIn \d+\/\d+$/).textContent();
    const startCount = Number((before ?? 'LinkedIn 0/10').split(' ')[1]?.split('/')[0] ?? 0);

    await analyse(page);

    // Retrieval renders before generation finishes, and both sections are present
    // in the reading order rather than behind a tab (D01, D04).
    await expect(page.getByRole('heading', { name: /replied to similar posts|Saved writing/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Useful things you can share' })).toBeVisible();

    const ideas = page.getByRole('button', { name: 'Use this', exact: true });
    await expect(ideas).toHaveCount(3);

    await ideas.first().click();

    const editor = page.getByRole('textbox', { name: 'Your reply' });
    await expect(editor).not.toHaveValue('');

    await editor.fill('My own final wording, which is what should be recorded.');

    await page.getByRole('button', { name: 'Copy reply' }).click();
    await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toBe('My own final wording, which is what should be recorded.');

    // Copying is not posting: the count has not moved.
    await expect(page.getByText(`LinkedIn ${startCount}/10`)).toBeVisible();

    await page.getByRole('button', { name: 'Mark posted' }).click();
    await expect(page.getByText(new RegExp(`Saved\\. LinkedIn ${startCount + 1}/10 today\\.`))).toBeVisible();

    // The saved text stays available until Next reply, so a mistake is recoverable.
    await expect(editor).toHaveValue('My own final wording, which is what should be recorded.');

    await page.getByRole('button', { name: 'Save as content idea' }).click();
    await expect(page.getByText('Saved to the Content backlog.')).toBeVisible();
    const backlog = await page.request.get('/api/backlog').then((response) => response.json());
    expect(
      backlog.data.flatMap((group: { items: { libraryId: string }[] }) => group.items)
        .some((item: { libraryId: string }) => item.libraryId.startsWith('IDEA-SR-')),
    ).toBe(true);

    await page.getByRole('button', { name: 'Next reply' }).click();
    await expect(page.getByRole('textbox', { name: /Paste the post or comment/ })).toHaveValue('');
  });

  test('records once when Mark posted is pressed twice', async ({ page }) => {
    await page.goto('/replies');
    const before = await page.getByText(/^X \d+\/\d+$/).textContent();
    const startCount = Number((before ?? 'X 0/10').split(' ')[1]?.split('/')[0] ?? 0);

    await page.getByRole('radio', { name: 'X' }).click();
    await analyse(page);

    const editor = page.getByRole('textbox', { name: 'Your reply' });
    await editor.fill('One reply, submitted twice.');

    const markPosted = page.getByRole('button', { name: 'Mark posted' });
    await markPosted.click();

    await expect(page.getByText(new RegExp(`Saved\\. X ${startCount + 1}/10 today\\.`))).toBeVisible();
    // The button is replaced by Undo and Next reply, so a second press cannot land.
    await expect(markPosted).toHaveCount(0);
  });

  test('keeps the editor usable while ideas are still arriving', async ({ page }) => {
    await page.goto('/replies');
    await analyse(page);

    const editor = page.getByRole('textbox', { name: 'Your reply' });
    await editor.fill('Typed while the model was thinking.');

    await expect(page.getByRole('button', { name: 'Use this', exact: true })).toHaveCount(3);

    // A result that arrives after the owner has typed does not touch their text.
    await expect(editor).toHaveValue('Typed while the model was thinking.');
  });

  test('previews a replacement rather than overwriting a dirty editor', async ({ page }) => {
    await page.goto('/replies');
    await analyse(page);

    const editor = page.getByRole('textbox', { name: 'Your reply' });
    await editor.fill('My own words.');

    await page.getByRole('button', { name: 'Use this', exact: true }).first().click();

    await expect(page.getByText('Review this version before replacing your reply.')).toBeVisible();
    await expect(editor).toHaveValue('My own words.');

    await page.getByRole('button', { name: 'Keep my reply' }).click();
    await expect(editor).toHaveValue('My own words.');
  });
});

test.describe('Threads', () => {
  test('writes Chinese, offers an English meaning, and marks it stale on edit', async ({ page }) => {
    await page.goto('/replies');
    await page.getByRole('radio', { name: 'Threads' }).click();
    await analyse(page);

    await expect(page.getByRole('button', { name: 'Use this', exact: true })).toHaveCount(3);
    await page.getByRole('button', { name: 'Use this', exact: true }).first().click();

    const editor = page.getByRole('textbox', { name: 'Your reply' });
    const chinese = await editor.inputValue();
    expect(chinese).toMatch(/\p{Script=Han}/u);

    await editor.fill(`${chinese}加上一點補充。`);

    await expect(page.getByText('Your reply changed. Refresh the English meaning.')).toBeVisible();
  });
});

test.describe('layout', () => {
  for (const width of [375, 500, 600, 750, 1280]) {
    test(`does not scroll horizontally at ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/replies');
      await analyse(page);
      await expect(page.getByRole('heading', { name: 'Useful things you can share' })).toBeVisible();

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(0);
    });
  }

  test('keeps resources reachable in the reading order, not behind a tab', async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 900 });
    await page.goto('/replies');
    await analyse(page);

    const headings = await page.getByRole('heading', { level: 2 }).allTextContents();
    const order = headings.join(' | ');

    expect(order).toContain('Useful things you can share');
    expect(order.indexOf('Useful things you can share')).toBeLessThan(order.indexOf('Reply ideas'));
    expect(order.indexOf('Reply ideas')).toBeLessThan(order.indexOf('Your reply'));
  });

  test('reflows at 200% zoom with every control still reachable', async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 900 });
    await page.goto('/replies');
    // 200% zoom is equivalent to halving the CSS viewport.
    await page.setViewportSize({ width: 300, height: 450 });
    await analyse(page);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(page.getByRole('button', { name: 'Mark posted' })).toBeVisible();
  });
});

test.describe('keyboard and input method', () => {
  test('Ctrl+Enter submits, but a composition commit does not', async ({ page }) => {
    // Count the requests rather than looking for their effects.
    //
    // The previous version waited for the "Reply ideas" heading, which is
    // rendered unconditionally at page load, so it was not a synchronisation
    // point at all: the negative assertion that followed passed on its first
    // poll, before any request it was meant to forbid could have returned. A
    // request counter cannot pass early, because the number is zero or it is not.
    let analyseCalls = 0;
    await page.route('**/api/replies/analyse', async (route) => {
      analyseCalls += 1;
      await route.continue();
    });

    await page.goto('/replies');
    const source = page.getByRole('textbox', { name: /Paste the post or comment/ });
    await source.fill(SOURCE_POST);

    // An IME candidate commit arrives as Enter with isComposing set. It must not
    // fire the request: the owner is choosing a character, not asking for ideas.
    await source.evaluate((element) => {
      element.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, isComposing: true, bubbles: true }),
      );
    });

    // Long enough that a request triggered by that keystroke would have been
    // counted by now.
    await page.waitForTimeout(750);
    expect(analyseCalls, 'a composition commit asked for ideas').toBe(0);

    await source.press('Control+Enter');
    await expect(page.getByRole('button', { name: 'Use this', exact: true })).toHaveCount(3);
    expect(analyseCalls).toBe(1);
  });

  test('empty input asks for the post rather than searching for nothing', async ({ page }) => {
    await page.goto('/replies');
    await page.getByRole('textbox', { name: /Paste the post or comment/ }).fill('   ');
    await page.getByRole('button', { name: 'Get reply ideas' }).click();

    await expect(page.getByText('Paste the post or comment first.')).toBeVisible();
  });

  test('background results do not steal focus', async ({ page }) => {
    await page.goto('/replies');
    await analyse(page);

    const editor = page.getByRole('textbox', { name: 'Your reply' });
    await editor.focus();
    await expect(page.getByRole('button', { name: 'Use this', exact: true })).toHaveCount(3);

    await expect(editor).toBeFocused();
  });
});

test.describe('reply text shows the way it will be posted', () => {
  test('a paragraph break survives from the idea card to the editor to the clipboard', async ({
    page,
    context,
  }) => {
    // Every read-only view used to render reply text in a plain paragraph, which
    // collapses line breaks: the card showed one run-on block while the editor
    // showed the same text with its breaks. `innerText` is layout-aware, so it
    // reports collapsed breaks as spaces. That makes this a check on what is
    // actually rendered, not on which class name the element happens to carry.
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/replies');
    await analyse(page);
    await expect(page.getByRole('button', { name: 'Use this', exact: true })).toHaveCount(3);

    const card = page.getByRole('listitem').filter({ hasText: 'The shortlist usually turns' });
    const shown = await card
      .locator('p', { hasText: 'The shortlist usually turns' })
      .evaluate((el) => (el as HTMLElement).innerText);
    expect(shown).toContain('decides it.\n\nThe shortlist');

    await card.getByRole('button', { name: 'Use this', exact: true }).click();
    const editor = page.getByRole('textbox', { name: 'Your reply' });
    const inEditor = await editor.inputValue();
    expect(inEditor).toContain('decides it.\n\nThe shortlist');

    await page.getByRole('button', { name: 'Copy reply' }).click();
    await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
    // Chrome on Windows stores clipboard text with CRLF line endings, whatever the
    // page wrote, and every paste target turns them back into plain breaks. That is
    // the operating system, not the app, so line endings are compared normalised.
    // On Linux CI no conversion happens and the comparison is exact either way.
    const copied = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n');
    expect(copied).toBe(inEditor);
    // And nothing a platform would show as a literal markup character.
    expect(copied).not.toMatch(/\*\*|^#{1,6} |\]\(/m);
  });

  test('bold from the toolbar reaches the clipboard as letters a platform displays', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/replies');

    const editor = page.getByRole('textbox', { name: 'Your reply' });
    await editor.fill('Ask for the range first');
    // Select "range", then press Bold.
    await editor.evaluate((el) => (el as HTMLTextAreaElement).setSelectionRange(12, 17));
    await page
      .getByRole('toolbar', { name: 'Formatting' })
      .getByRole('button', { name: 'Bold', exact: true })
      .click();

    // Mathematical sans-serif bold "range": what LinkedIn shows as bold text.
    const bold = '\u{1D5FF}\u{1D5EE}\u{1D5FB}\u{1D5F4}\u{1D5F2}';
    await expect(editor).toHaveValue(`Ask for the ${bold} first`);

    await page.getByRole('button', { name: 'Copy reply' }).click();
    await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe(`Ask for the ${bold} first`);
    expect(copied).not.toContain('*');
  });
});

test.describe('honest states', () => {
  test('tells no-match apart from a failure', async ({ page }) => {
    await page.goto('/replies');
    await analyse(page, 'Zzzq unrelated gibberish that matches nothing in the library at all.');

    // A successful search with no match, not an error.
    await expect(page.getByText('No matching past replies yet.')).toBeVisible();
    await expect(page.getByText("Couldn't search past replies.")).toHaveCount(0);
  });

  test('never presents an AI draft as something the owner posted', async ({ page }) => {
    // Every assertion here runs unconditionally.
    //
    // The previous version put its single expect inside two nested ifs whose
    // inner condition could not be true, so it executed nothing and passed for
    // the wrong reason. Worse, the heading it meant to forbid was present in the
    // state it was checking.
    await page.goto('/replies');
    await analyse(page, 'example ai draft that was never posted');

    // Scoped to the result rows, not the page: the query itself sits in the
    // source box, so a page-wide text match would find the words the test just
    // typed and prove nothing.
    const rows = page.getByRole('listitem');
    await expect(rows.filter({ hasText: 'Example AI draft that was never posted' })).toHaveCount(0);

    // Two confirmed replies do match this query, so the section is populated and
    // the assertion above is about exclusion rather than an empty list.
    await expect(rows.filter({ hasText: 'Example past reply' }).first()).toBeVisible();

    // And nothing on offer is labelled as a draft, because voice evidence is
    // confirmed writing only.
    await expect(rows.getByText('AI draft', { exact: true })).toHaveCount(0);

    // It is still the owner's own writing, so the library finds it, labelled
    // honestly rather than hidden or dressed up as a reply.
    await page.goto('/replies/library');
    await page
      .getByRole('textbox', { name: 'Search your past replies' })
      .fill('example ai draft that was never posted');
    await page.getByRole('button', { name: 'Search', exact: true }).click();

    const libraryRow = page
      .getByRole('listitem')
      .filter({ hasText: 'Example AI draft that was never posted' });
    await expect(libraryRow).toBeVisible();
    // Exact, because the reply's own text contains the words as well as the
    // provenance pill does.
    await expect(libraryRow.getByText('AI draft', { exact: true })).toBeVisible();
    await expect(libraryRow.getByText('Posted', { exact: true })).toHaveCount(0);
  });
});

test.describe('when the clipboard refuses (COPY-01)', () => {
  test('selects the reply text and never claims success', async ({ page }) => {
    await page.goto('/replies');
    // Make writeText reject before anything runs, so the denied path is real
    // rather than simulated at the component boundary.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: () => Promise.reject(new Error('denied')) },
      });
    });
    await page.reload();

    await page.getByRole('textbox', { name: /Paste the post or comment/ }).fill(SOURCE_POST);
    await page.getByRole('button', { name: 'Get reply ideas' }).click();

    const editor = page.getByRole('textbox', { name: 'Your reply' });
    await editor.fill('The exact text that must end up selected.');

    const before = await page.getByText(/^LinkedIn \d+\/\d+$/).textContent();

    await page.getByRole('button', { name: 'Copy reply' }).click();

    await expect(
      page.getByText("Couldn't copy automatically. Select the text and copy it."),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copied' })).toHaveCount(0);

    // The editor holds the selection, so Ctrl+C works, and it is the reply text
    // rather than the surrounding interface.
    const selection = await page.evaluate(() => {
      const element = document.getElementById('final-reply-editor');
      if (!(element instanceof HTMLTextAreaElement)) return null;
      return element.value.slice(element.selectionStart, element.selectionEnd);
    });
    expect(selection).toBe('The exact text that must end up selected.');

    // A failed copy is not a post, so the count has not moved.
    await expect(page.getByText(before ?? '')).toBeVisible();
  });
});

test.describe('the action strip reserves its own height (D01)', () => {
  test('never covers the end of the reply, including after it changes size', async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 900 });
    await page.goto('/replies');
    await analyse(page);

    const editor = page.getByRole('textbox', { name: 'Your reply' });
    await editor.fill('A reply long enough to push the page past one screen.\n'.repeat(12));

    async function bottomIsReachable() {
      return page.evaluate(() => {
        const strip = document.querySelector('[data-strip]') ?? document.body.lastElementChild;
        const reserved = getComputedStyle(document.documentElement).getPropertyValue(
          '--sr-action-strip-height',
        );
        const height = strip instanceof HTMLElement ? strip.offsetHeight : 0;
        return { reserved: parseFloat(reserved) || 0, height };
      });
    }

    // The measurement is written by a ResizeObserver, which fires after the paint
    // that changed the height. Reading once races it, so poll until the reserved
    // space matches what is on screen.
    const matches = async () => {
      const { reserved, height } = await bottomIsReachable();
      return reserved > 0 && Math.abs(reserved - height) <= 2;
    };

    await expect.poll(matches, { timeout: 5_000 }).toBe(true);

    // Recording swaps the strip for Undo and Next reply, which is a different
    // height. The reserved space has to follow it.
    await page.getByRole('button', { name: 'Mark posted' }).click();
    await expect(page.getByText(/Saved\./)).toBeVisible();

    await expect.poll(matches, { timeout: 5_000 }).toBe(true);
  });
});
