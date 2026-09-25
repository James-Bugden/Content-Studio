import { test, expect } from '@playwright/test';

/**
 * The error contract, over the wire, against a production build.
 *
 * Every one of these passed as a unit test while the shipped app answered 500.
 * `instanceof AppError` was false in the production bundle, because Next hands a
 * server component and a route handler separate copies of the module, and the
 * store was constructed by one while the route caught from the other. Nothing
 * that imports the modules directly can see that: there is only ever one copy in
 * a test runner.
 *
 * So these run through HTTP, against `next build` output, which is the only place
 * the bug existed.
 *
 * They also load a page first, and that detail is the whole test. The chunk split
 * only bites when the store is *constructed* by the server-component chunk and the
 * error is *caught* by the route-handler chunk. An API call on its own builds the
 * store inside the route chunk, so both halves agree and the bug hides. Two
 * separate attempts to confirm this defect concluded it did not reproduce, for
 * exactly that reason; the first version of this file passed with the bug
 * deliberately reintroduced.
 *
 * One trap when checking that by hand: `reuseExistingServer` is on outside CI,
 * so a server left running from an earlier build is silently reused and the
 * rebuild never happens. Two runs reported five passes against a stale binary
 * before that was noticed. Kill anything on 3100 before trusting a green run.
 */

/**
 * Forces the server-component chunk to build the store before any route touches it.
 *
 * Without this line every assertion below passes whether the bug is present or not.
 */
async function loadPageFirst(page: import('@playwright/test').Page) {
  await page.goto('/replies');
  await expect(page.getByRole('link', { name: 'Replies', exact: true })).toBeVisible();
}

test.beforeEach(async ({ request }) => {
  await request.post('/api/replies/test/reset');
});

async function newSession(request: import('@playwright/test').APIRequestContext, origin: string) {
  const response = await request.post('/api/replies/analyse', {
    headers: { origin },
    data: {
      request_key: '11111111-1111-4111-8111-111111111111',
      platform: 'linkedin',
      target_kind: 'post',
      source_text: 'Testing a stale session save.',
    },
  });
  expect(response.status()).toBe(200);
  return (await response.json()).session_id as string;
}

test.describe('a deliberate conflict reaches the caller as a conflict', () => {
  test('a stale editor version is 409, not 500', async ({ page, request, baseURL }) => {
    await loadPageFirst(page);
    const origin = new URL(baseURL!).origin;
    const sessionId = await newSession(request, origin);

    // A fresh session is at editor_version 0, so 5 is deliberately wrong.
    const response = await request.patch('/api/replies/session', {
      headers: { origin },
      data: { session_id: sessionId, expected_editor_version: 5, draft_text: 'hello' },
    });

    expect(response.status()).toBe(409);
    const body = await response.json();
    expect(body.code).toBe('version_conflict');
    // Not the generic internal message, which is what a swallowed AppError looked
    // like, and which reads to the owner as though the server crashed.
    expect(body.message).not.toBe('Something went wrong. Your text is still here.');
    expect(body.retryable).toBe(false);
  });

  test('a session that does not exist is 404', async ({ page, request, baseURL }) => {
    await loadPageFirst(page);
    const origin = new URL(baseURL!).origin;

    const response = await request.patch('/api/replies/session', {
      headers: { origin },
      data: {
        session_id: '00000000-0000-4000-8000-000000000999',
        expected_editor_version: 0,
        draft_text: 'hello',
      },
    });

    expect(response.status()).toBe(404);
    expect((await response.json()).code).toBe('not_found');
  });

  test('a cross-origin mutation is 403', async ({ page, request, baseURL }) => {
    await loadPageFirst(page);
    const sessionId = await newSession(request, new URL(baseURL!).origin);

    const response = await request.patch('/api/replies/session', {
      headers: { origin: 'https://evil.example.com' },
      data: { session_id: sessionId, expected_editor_version: 0, draft_text: 'hello' },
    });

    expect(response.status()).toBe(403);
    expect((await response.json()).code).toBe('forbidden');
  });

  test('a stale resource version is 409 on the administration route too', async ({
    page,
    request,
    baseURL,
  }) => {
    // The same shape of failure was reproduced on this route independently, so it
    // is pinned independently. The Resources page is what built the store when it
    // was first seen, so this one loads that page rather than the workspace.
    await page.goto('/replies/resources');
    await expect(page.getByRole('heading', { name: 'Resources' }).first()).toBeVisible();
    const origin = new URL(baseURL!).origin;
    const resources = await request.get('/api/replies/resources').then((r) => r.json());
    const first = resources.resources[0];

    const response = await request.patch(`/api/replies/resources/${first.id}`, {
      headers: { origin },
      data: { expected_version: first.version + 99, changes: { active: false } },
    });

    expect(response.status()).toBe(409);
    expect((await response.json()).code).toBe('version_conflict');
  });

  test('every error body carries a request id and no stack trace', async ({
    page,
    request,
    baseURL,
  }) => {
    await loadPageFirst(page);
    const origin = new URL(baseURL!).origin;
    const sessionId = await newSession(request, origin);

    const response = await request.patch('/api/replies/session', {
      headers: { origin },
      data: { session_id: sessionId, expected_editor_version: 5, draft_text: 'hello' },
    });
    const body = await response.json();

    // Asserted here too, so this case fails on the defect rather than passing
    // while reporting a well-formed 500.
    expect(response.status()).toBe(409);
    expect(body.request_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(body)).not.toMatch(/at \w+ \(/);
    expect(JSON.stringify(body)).not.toContain('node_modules');
  });
});
