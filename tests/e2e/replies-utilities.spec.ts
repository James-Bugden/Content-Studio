import { test, expect } from '@playwright/test';

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
 * The four utility pages (SR-018).
 *
 * Library, Resources, Facts and Settings are not the product's main loop, but they
 * carry three rules that are easy to get quietly wrong: private search text must
 * never reach a URL (SEC-05), a new fact must never be approved by the act of
 * creating it (C06), and a stale edit must surface as a conflict rather than
 * silently overwrite someone else's newer save (C07). These run against the same
 * in-memory store and seed data as `reply-journey.spec.ts`, so a test here that
 * reads a seed reply's or resource's exact wording is reading the fixtures defined
 * in `src/lib/server/memory-store.ts`.
 */

test.describe('library search', () => {
  test('keeps the search text out of the URL and tells a match apart from an honest empty result', async ({
    page,
  }) => {
    await page.goto('/replies/library');

    const search = page.getByRole('textbox', { name: /Search your past replies/ });

    await search.fill('cover letter');
    // "Search" is a prefix of the button's own loading label "Searching...", so
    // this has to be exact or it would match either state.
    await page.getByRole('button', { name: 'Search', exact: true }).click();

    await expect(page.getByText(/cover letter/i).first()).toBeVisible();
    expect(page.url()).not.toContain('cover');
    expect(page.url()).not.toContain('letter');

    await search.fill('zzzq nonexistent gibberish that matches nothing');
    await page.getByRole('button', { name: 'Search', exact: true }).click();

    // A successful search with no match, not an error, and the query text is still
    // nowhere in the address bar.
    await expect(page.getByText('No matching replies yet.')).toBeVisible();
    await expect(page.getByText("Couldn't search the library.")).toHaveCount(0);
    expect(page.url()).not.toContain('zzzq');
    expect(page.url()).toBe(`${new URL(page.url()).origin}/replies/library`);
  });

  test('an explicit correction updates the text and a withdrawal removes it from the results', async ({ page }) => {
    await page.goto('/replies/library');

    const search = page.getByRole('textbox', { name: /Search your past replies/ });
    await search.fill('hiring managers skim');
    await page.getByRole('button', { name: 'Search', exact: true }).click();

    const row = page.locator('li').filter({ hasText: 'hiring managers skim' });
    await expect(row).toBeVisible();

    await row.getByRole('button', { name: 'Correct', exact: true }).click();
    const correctionText = row.getByRole('textbox', { name: 'Corrected text' });
    await correctionText.fill('Example past reply, corrected for the browser journey.');
    await row.getByRole('button', { name: 'Save correction' }).click();

    await expect(page.getByText('Correction saved.')).toBeVisible();

    // `row` was found by its old wording, which the correction just replaced, so a
    // locator filtered on the old text no longer matches anything. Re-find it by
    // the new text instead of reusing the stale handle.
    const updatedRow = page.locator('li').filter({ hasText: 'Example past reply, corrected for the browser journey.' });
    await expect(updatedRow).toBeVisible();

    await updatedRow.getByRole('button', { name: 'Withdraw recorded status', exact: true }).click();
    await updatedRow.getByRole('button', { name: 'Withdraw', exact: true }).click();

    await expect(page.getByText('Withdrawn from your recorded replies.')).toBeVisible();
    await expect(
      page.locator('li').filter({ hasText: 'Example past reply, corrected for the browser journey.' }),
    ).toHaveCount(0);
  });
});

test.describe('facts', () => {
  test('a fact created through the UI comes back unapproved and excluded from generation', async ({ page }) => {
    await page.goto('/replies/facts');

    await page.getByRole('button', { name: 'Add fact', exact: true }).click();
    await page.getByRole('textbox', { name: 'Fact' }).fill('Example fact created in a browser journey.');
    await page.getByRole('button', { name: 'Save fact' }).click();

    await expect(page.getByText('Fact saved.')).toBeVisible();

    const row = page.locator('li').filter({ hasText: 'Example fact created in a browser journey.' });
    await expect(row.getByText('Excluded from generation')).toBeVisible();
    await expect(row.getByText('Not yet approved.')).toBeVisible();
  });

  test('a private-only fact stays visibly excluded even once approved and active', async ({ page }) => {
    await page.goto('/replies/facts');

    await page.getByRole('button', { name: 'Add fact', exact: true }).click();
    await page.getByRole('textbox', { name: 'Fact' }).fill('Example private-only fact for the browser journey.');
    await page.getByRole('button', { name: 'Save fact' }).click();
    await expect(page.getByText('Fact saved.')).toBeVisible();

    const row = page.locator('li').filter({ hasText: 'Example private-only fact for the browser journey.' });
    await row.getByRole('button', { name: 'Edit', exact: true }).click();

    // "Private, context only" is the form's default sensitivity, so approving it
    // here without touching sensitivity is exactly the case that must stay excluded.
    await page.getByRole('checkbox', { name: 'Approved for use' }).check();
    await page.getByRole('button', { name: 'Save fact' }).click();

    await expect(page.getByText('Fact saved.')).toBeVisible();
    await expect(row.getByText('Excluded from generation')).toBeVisible();
    await expect(row.getByText('Marked private, context only.')).toBeVisible();
  });
});

test.describe('resources', () => {
  test('disabling a resource removes it from what a new reply can offer', async ({ page }) => {
    await page.goto('/replies/resources');

    const row = page.locator('li').filter({ hasText: 'Example cover letter guide' });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Disable', exact: true }).click();

    await expect(page.getByText('Disabled. It will stop being offered in new replies immediately.')).toBeVisible();
    await expect(row.getByRole('button', { name: 'Enable', exact: true })).toBeVisible();
    await expect(row.getByText('Inactive')).toBeVisible();

    // The same guide qualified for this exact wording before it was disabled
    // (it is what qualifies it in the workspace's own resource lookup).
    await page.goto('/replies');
    await page
      .getByRole('textbox', { name: /Paste the post or comment/ })
      .fill('Does the opening line of a cover letter actually matter for this application?');
    await page.getByRole('button', { name: 'Get reply ideas' }).click();

    await expect(page.getByRole('heading', { name: 'Useful things you can share' })).toBeVisible();
    await expect(page.getByText('Example cover letter guide')).toHaveCount(0);
  });

  test('a stale version save shows a conflict and keeps what was typed', async ({ page, request }) => {
    await page.goto('/replies/resources');
    // Mutations are same-origin only (SEC-01), so a request made outside a real
    // page navigation has to carry the Origin header a browser would add itself.
    const origin = new URL(page.url()).origin;

    const before = await request.get('/api/replies/resources').then((r) => r.json());
    const book = before.resources.find((r: { title_en: string }) => r.title_en === 'Example book with no approved link');
    expect(book).toBeTruthy();

    const row = page.locator('li').filter({ hasText: 'Example book with no approved link' });
    await row.getByRole('button', { name: 'Edit', exact: true }).click();

    const titleField = page.getByRole('textbox', { name: 'Title (English)' });
    await titleField.fill('Edited title that must not be lost');

    // A second save lands first, from outside this open form, bumping the version
    // the open form does not know about.
    const bump = await request.patch(`/api/replies/resources/${book.id}`, {
      headers: { origin },
      data: { expected_version: book.version, changes: { active: book.active } },
    });
    expect(bump.ok()).toBe(true);

    await page.getByRole('button', { name: 'Save resource' }).click();

    await expect(page.getByText('This changed somewhere else. Reload before saving.')).toBeVisible();
    // The typed title is still in the form; nothing was silently overwritten or lost.
    await expect(titleField).toHaveValue('Edited title that must not be lost');
  });
});

test.describe('settings', () => {
  test('renders targets and a names-and-states configuration block', async ({ page }) => {
    await page.goto('/replies/settings');

    await expect(page.getByRole('heading', { name: 'Daily targets' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Configuration status' })).toBeVisible();

    // Never a key, a service-role value, SQL or a model picker (C10).
    await expect(page.getByText(/api[_ ]?key/i)).toHaveCount(0);
    await expect(page.getByText(/service[_ ]?role/i)).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: /model/i })).toHaveCount(0);
  });
});

test.describe('navigation', () => {
  test('every workspace nav link reaches a page that renders', async ({ page }) => {
    await page.goto('/replies');

    const destinations: { link: string; heading: string }[] = [
      { link: 'Library', heading: 'Library' },
      { link: 'Resources', heading: 'Resources' },
      { link: 'Facts', heading: 'Facts' },
      { link: 'Settings', heading: 'Daily targets' },
    ];

    for (const { link, heading } of destinations) {
      await page.goto('/replies');
      await page.getByRole('link', { name: link, exact: true }).click();
      await expect(page.getByRole('heading', { name: heading, exact: true }).first()).toBeVisible();
      // A 404 in this app has no h1/h2 heading matching the nav label at all, so
      // the assertion above already fails there; this just confirms the route
      // itself, not a client-side redirect, actually served the page.
      expect(page.url()).toContain(link === 'Settings' ? '/replies/settings' : `/replies/${link.toLowerCase()}`);
    }
  });
});

