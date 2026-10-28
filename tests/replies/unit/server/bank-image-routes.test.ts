import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { AiUsageService } from '@/application/ai-usage';
import { FakeAiGateway } from '@/integrations/ai/fake-gateway';
import { FakeAiUsageRepository } from '@/integrations/supabase/fake-ai-usage';
import { FakeImageRenderer } from '@/integrations/image-renderer/fake';
import { AppError } from '@/replies/lib/contracts/errors';
import { createMemoryStore } from '@/replies/lib/server/memory-store';
import { resetAiMemo } from '@/replies/lib/server/ai-memo';
import type { Store } from '@/replies/lib/server/store';

/**
 * #245 routes: the image bank, the tag suggestion and the Create new pipeline.
 *
 * Auth, same-origin, validation and the monthly cap are checked at the route, with
 * the real in-memory store and the real fake AI gateway behind the real usage
 * tracker. A refusal is only a refusal if nothing behind it ran.
 */

const mocks = vi.hoisted(() => ({
  requireOwner: vi.fn(),
  store: null as unknown,
  ai: null as unknown,
  renderer: null as unknown,
}));

vi.mock('@/replies/lib/auth/owner', () => ({
  requireOwner: mocks.requireOwner,
  getOwnerSession: vi.fn(),
  noSessionReason: vi.fn(),
}));
vi.mock('@/replies/lib/server/get-store', () => ({ getStore: () => mocks.store, isTestMode: () => false }));
vi.mock('@/application/container', () => ({ getServices: () => ({ ai: mocks.ai }) }));
vi.mock('@/integrations/image-renderer/container', () => ({ getImageRenderer: () => mocks.renderer }));

import { GET as listImages, POST as uploadImage } from '@/app/api/replies/images/route';
import { PATCH as patchImage, DELETE as deleteImage } from '@/app/api/replies/images/[id]/route';
import { GET as readFile } from '@/app/api/replies/images/[id]/file/route';
import { POST as suggestMeta } from '@/app/api/replies/images/suggest/route';
import { POST as createPipeline } from '@/app/api/replies/images/create/route';

const ORIGIN = 'http://localhost:3000';
const SEED_ID = '66666666-6666-4666-8666-000000000001';

let store: Store;
let usage: FakeAiUsageRepository;
let renderer: FakeImageRenderer;

beforeEach(() => {
  store = createMemoryStore();
  usage = new FakeAiUsageRepository();
  renderer = new FakeImageRenderer();
  mocks.store = store;
  mocks.ai = new FakeAiGateway(new AiUsageService(usage));
  mocks.renderer = renderer;
  mocks.requireOwner.mockReset();
  mocks.requireOwner.mockResolvedValue({ userId: 'owner', supabase: null });
  resetAiMemo();
});

function pngBytes(size = 64): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return bytes;
}

function request(path: string, init: { method: string; body?: BodyInit; headers?: Record<string, string>; origin?: string | null }) {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (init.origin !== null) headers.origin = init.origin ?? ORIGIN;
  return new NextRequest(`${ORIGIN}${path}`, { method: init.method, headers, ...(init.body ? { body: init.body } : {}) });
}

function jsonRequest(path: string, method: string, body: unknown, origin?: string | null) {
  return request(path, {
    method,
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
    ...(origin !== undefined ? { origin } : {}),
  });
}

function uploadForm(overrides: { file?: File | null; fields?: Record<string, string> } = {}) {
  const form = new FormData();
  const file = overrides.file === undefined ? new File([pngBytes()], 'checklist.png', { type: 'image/png' }) : overrides.file;
  if (file) form.set('file', file);
  const fields = { request_key: 'upload-1', title: 'Checklist', alt_text: 'A checklist.', tags: 'Cover Letter, #checklist', ...overrides.fields };
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return form;
}

const upload = (form: FormData, origin?: string | null) =>
  uploadImage(request('/api/replies/images', { method: 'POST', body: form, ...(origin !== undefined ? { origin } : {}) }));

async function body(response: Response) {
  return (await response.json()) as Record<string, unknown> & { code?: string; message?: string };
}

describe('every route needs the owner', () => {
  it('answers 401 and runs nothing when there is no owner session', async () => {
    mocks.requireOwner.mockRejectedValue(new AppError('unauthenticated', 'Sign in to continue.'));
    const create = vi.spyOn(store, 'createBankImage');
    const run = vi.spyOn(mocks.ai as FakeAiGateway, 'run');

    const responses = await Promise.all([
      listImages(request('/api/replies/images', { method: 'GET' })),
      upload(uploadForm()),
      patchImage(jsonRequest(`/api/replies/images/${SEED_ID}`, 'PATCH', { expected_version: 1, request_key: 'k', changes: { title: 'x' } })),
      deleteImage(jsonRequest(`/api/replies/images/${SEED_ID}`, 'DELETE', { expected_version: 1, request_key: 'k' })),
      readFile(request(`/api/replies/images/${SEED_ID}/file`, { method: 'GET' })),
      suggestMeta(jsonRequest('/api/replies/images/suggest', 'POST', { request_key: 'k', file_name: 'a.png' })),
      createPipeline(jsonRequest('/api/replies/images/create', 'POST', { action: 'sketch', request_key: 'k', title: 'T', brief: 'B', platform: 'linkedin' })),
    ]);

    expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401, 401, 401, 401]);
    expect(create).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(usage.calls).toHaveLength(0);
  });
});

describe('every mutation is same-origin only (CSRF)', () => {
  it('refuses a missing, foreign or opaque Origin before reading the body', async () => {
    const create = vi.spyOn(store, 'createBankImage');
    for (const origin of [null, 'https://evil.example', 'null']) {
      const response = await upload(uploadForm(), origin);
      expect(response.status).toBe(403);
    }
    expect((await patchImage(jsonRequest(`/api/replies/images/${SEED_ID}`, 'PATCH', { expected_version: 1, request_key: 'k', changes: {} }, 'https://evil.example'))).status).toBe(403);
    expect((await deleteImage(jsonRequest(`/api/replies/images/${SEED_ID}`, 'DELETE', { expected_version: 1, request_key: 'k' }, null))).status).toBe(403);
    expect((await suggestMeta(jsonRequest('/api/replies/images/suggest', 'POST', { request_key: 'k', file_name: 'a.png' }, 'https://evil.example'))).status).toBe(403);
    expect(
      (await createPipeline(jsonRequest('/api/replies/images/create', 'POST', { action: 'sketch', request_key: 'k', title: 'T', brief: 'B', platform: 'x' }, 'https://evil.example'))).status,
    ).toBe(403);
    expect(create).not.toHaveBeenCalled();
    expect(usage.calls).toHaveLength(0);
  });
});

describe('upload validation', () => {
  it('rejects a request that is not a form with a file', async () => {
    const notForm = await uploadImage(jsonRequest('/api/replies/images', 'POST', { title: 'x' }));
    expect(notForm.status).toBe(400);
    const noFile = await upload(uploadForm({ file: null }));
    expect(noFile.status).toBe(400);
  });

  it('rejects the wrong type by its bytes, whatever the browser called it', async () => {
    const svg = new File(['<svg xmlns="http://www.w3.org/2000/svg"></svg>'], 'x.png', { type: 'image/png' });
    const response = await upload(uploadForm({ file: svg }));
    expect(response.status).toBe(400);
    expect((await body(response)).message).toBe('Use a PNG, JPG or WebP image.');
    const lying = new File([pngBytes()], 'x.jpg', { type: 'image/jpeg' });
    expect((await body(await upload(uploadForm({ file: lying })))).message).toBe('That file is not the type it says it is.');
  });

  it('rejects an empty file and an oversize one with 413', async () => {
    expect((await upload(uploadForm({ file: new File([], 'x.png', { type: 'image/png' }) }))).status).toBe(400);
    const big = new File([pngBytes(5 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' });
    const response = await upload(uploadForm({ file: big }));
    expect(response.status).toBe(413);
    expect((await body(response)).message).toBe('That image is over 5 MB.');
    expect((await store.listBankImages()).length).toBe(1);
  });

  it('accepts exactly 5 MB', async () => {
    const edge = new File([pngBytes(5 * 1024 * 1024)], 'edge.png', { type: 'image/png' });
    expect((await upload(uploadForm({ file: edge, fields: { request_key: 'edge' } }))).status).toBe(200);
  });

  it('needs a title and a request key', async () => {
    expect((await upload(uploadForm({ fields: { title: '   ' } }))).status).toBe(400);
    expect((await upload(uploadForm({ fields: { request_key: '' } }))).status).toBe(400);
  });

  it('stores normalised tags and returns no bytes in the list', async () => {
    const created = await body(await upload(uploadForm()));
    expect(created).toMatchObject({ replayed: false });
    const listed = (await body(await listImages(request('/api/replies/images', { method: 'GET' })))) as { images: Record<string, unknown>[] };
    const mine = listed.images.find((image) => image.id === created.id)!;
    expect(mine.tags).toEqual(['cover letter', 'checklist']);
    expect(mine.url).toBe(`/api/replies/images/${created.id}/file`);
    expect(JSON.stringify(listed)).not.toContain('bytes');
  });
});

describe('upload idempotency', () => {
  it('returns the image already made when the same key and details arrive again', async () => {
    const first = await body(await upload(uploadForm()));
    const second = await body(await upload(uploadForm()));
    expect(second).toMatchObject({ id: first.id, replayed: true });
    expect((await store.listBankImages()).length).toBe(2);
  });

  it('refuses the same key with different details', async () => {
    await upload(uploadForm());
    const response = await upload(uploadForm({ fields: { title: 'Something else' } }));
    expect(response.status).toBe(409);
    expect((await body(response)).code).toBe('idempotency_conflict');
  });
});

describe('the private file route', () => {
  it('serves bytes as an inert, privately cached image', async () => {
    const response = await readFile(request(`/api/replies/images/${SEED_ID}/file`, { method: 'GET' }));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
    expect(response.headers.get('cache-control')).toContain('private');
    expect(response.headers.get('cache-control')).not.toContain('public');
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('is a plain not-found for an unknown id, a malformed id and a sketch with no pixels yet', async () => {
    expect((await readFile(request('/api/replies/images/66666666-6666-4666-8666-0000000000ff/file', { method: 'GET' }))).status).toBe(404);
    expect((await readFile(request('/api/replies/images/not-an-id/file', { method: 'GET' }))).status).toBe(404);
    const sketch = await body(
      await createPipeline(jsonRequest('/api/replies/images/create', 'POST', { action: 'sketch', request_key: 's1', title: 'T', brief: 'B', platform: 'linkedin' })),
    );
    const id = (sketch.image as { id: string }).id;
    expect((await readFile(request(`/api/replies/images/${id}/file`, { method: 'GET' }))).status).toBe(404);
  });

  it('does not use the browser-visible stored type: a non-image stored under an image row is refused', async () => {
    const created = await store.createBankImage({
      requestKey: 'bad', requestHash: 'h', title: 'Bad', altText: '', tags: [], origin: 'upload', status: 'ready', sketch: '', brief: '',
      file: { bytes: new TextEncoder().encode('<script>alert(1)</script>'), mime: 'image/png', sha256: 'a'.repeat(64) },
    });
    expect((await readFile(request(`/api/replies/images/${created.id}/file`, { method: 'GET' }))).status).toBe(404);
  });
});

describe('edit and delete', () => {
  const patch = (id: string, data: unknown) => patchImage(jsonRequest(`/api/replies/images/${id}`, 'PATCH', data));
  const remove = (id: string, data: unknown) => deleteImage(jsonRequest(`/api/replies/images/${id}`, 'DELETE', data));

  it('validates the body and the id', async () => {
    expect((await patch(SEED_ID, { request_key: 'k', changes: { title: 'x' } })).status).toBe(400);
    expect((await patch(SEED_ID, { expected_version: 1, changes: { title: 'x' } })).status).toBe(400);
    expect((await patch(SEED_ID, { expected_version: 1, request_key: 'k', changes: { title: '' } })).status).toBe(400);
    expect((await patch('not-an-id', { expected_version: 1, request_key: 'k', changes: { title: 'x' } })).status).toBe(400);
    expect((await remove(SEED_ID, {})).status).toBe(400);
  });

  it('changes only what was sent and bumps the version', async () => {
    const response = await patch(SEED_ID, { expected_version: 1, request_key: 'edit-1', changes: { title: 'Renamed', tags: ['One', '#two'] } });
    expect(await body(response)).toMatchObject({ id: SEED_ID, version: 2 });
    const row = (await store.getBankImage(SEED_ID))!;
    expect(row).toMatchObject({ title: 'Renamed', tags: ['one', 'two'], alt_text: 'An example checklist for a cover letter.', active: true });
  });

  it('refuses a stale form instead of overwriting the newer edit', async () => {
    await patch(SEED_ID, { expected_version: 1, request_key: 'edit-1', changes: { title: 'Newer' } });
    const stale = await patch(SEED_ID, { expected_version: 1, request_key: 'edit-2', changes: { title: 'Older' } });
    expect(stale.status).toBe(409);
    expect((await store.getBankImage(SEED_ID))!.title).toBe('Newer');
  });

  it('treats a repeated key as a replay, not a second change', async () => {
    const first = await body(await patch(SEED_ID, { expected_version: 1, request_key: 'same', changes: { title: 'Once' } }));
    const again = await body(await patch(SEED_ID, { expected_version: 1, request_key: 'same', changes: { title: 'Once' } }));
    expect(again.version).toBe(first.version);
    expect((await store.getBankImage(SEED_ID))!.version).toBe(2);
  });

  it('deletes with the right version, replays safely, and refuses a stale delete', async () => {
    expect((await remove(SEED_ID, { expected_version: 9, request_key: 'd1' })).status).toBe(409);
    expect(await store.getBankImage(SEED_ID)).not.toBeNull();
    expect((await remove(SEED_ID, { expected_version: 1, request_key: 'd1' })).status).toBe(200);
    expect(await store.getBankImage(SEED_ID)).toBeNull();
    expect((await remove(SEED_ID, { expected_version: 1, request_key: 'd1' })).status).toBe(200);
    expect((await remove(SEED_ID, { expected_version: 1, request_key: 'other' })).status).toBe(404);
  });
});

describe('the tag suggestion (one small AI call)', () => {
  const suggest = (data: unknown, origin?: string | null) => suggestMeta(jsonRequest('/api/replies/images/suggest', 'POST', data, origin));

  it('returns editable, normalised fields and records usage under its own feature', async () => {
    const response = await suggest({ request_key: 'tags-1', file_name: 'cover-letter-checklist.png', hint: 'a checklist for letters' });
    expect(response.status).toBe(200);
    const result = await body(response);
    expect(result).toMatchObject({ title: 'Example cover letter checklist', alt_text: 'a checklist for letters' });
    // "#fake image" and a repeated "Example" arrive already cleaned and de-duplicated.
    expect(result.tags).toEqual(['example', 'fake image', 'cover letter checklist']);
    expect(usage.calls.map((call) => call.feature)).toEqual(['bank_image_tags']);
    expect(usage.calls[0]).toMatchObject({ status: 'completed' });
  });

  it('is one billed call however many times the same key arrives', async () => {
    const data = { request_key: 'tags-2', file_name: 'a.png' };
    await Promise.all([suggest(data), suggest(data), suggest(data)]);
    await suggest(data);
    expect(usage.calls).toHaveLength(1);
  });

  it('refuses the same key with a different file name', async () => {
    await suggest({ request_key: 'tags-3', file_name: 'a.png' });
    expect((await suggest({ request_key: 'tags-3', file_name: 'b.png' })).status).toBe(409);
  });

  it('validates its input', async () => {
    expect((await suggest({ file_name: 'a.png' })).status).toBe(400);
    expect((await suggest({ request_key: 'k' })).status).toBe(400);
    expect((await suggest({ request_key: 'k', file_name: 'a.png', hint: 'x'.repeat(501) })).status).toBe(400);
    expect(usage.calls).toHaveLength(0);
  });

  it('is refused at the cap with "Monthly AI limit reached" and no call is made', async () => {
    await usage.setCap({ operationId: '00000000-0000-4000-8000-000000000001', expectedVersion: 1, capMicros: 0, actorHash: 'a'.repeat(64) });
    const response = await suggest({ request_key: 'tags-4', file_name: 'a.png' });
    expect(response.status).toBe(429);
    const result = await body(response);
    expect(result.code).toBe('monthly_ai_limit_reached');
    expect(result.message).toBe('Monthly AI limit reached');
    expect(usage.calls).toHaveLength(0);
    expect((mocks.ai as FakeAiGateway).requests).toHaveLength(0);
  });

  it('says it is not set up, rather than failing oddly, when no AI is configured', async () => {
    mocks.ai = { run: async () => ({ ok: false, code: 'CONFIG_MISSING', meta: {} }) };
    const response = await suggest({ request_key: 'tags-5', file_name: 'a.png' });
    expect(response.status).toBe(503);
    expect((await body(response)).code).toBe('not_configured');
  });

  it('a failed call can be retried with the same key', async () => {
    (mocks.ai as FakeAiGateway).failNext('PROVIDER_UNAVAILABLE');
    expect((await suggest({ request_key: 'tags-6', file_name: 'a.png' })).status).toBe(503);
    expect((await suggest({ request_key: 'tags-6', file_name: 'a.png' })).status).toBe(200);
  });
});

describe('Create new: sketch, approve, image', () => {
  const step = (data: unknown, origin?: string | null) => createPipeline(jsonRequest('/api/replies/images/create', 'POST', data, origin));
  const sketchStep = (key = 'sk-1') => step({ action: 'sketch', request_key: key, title: 'Next step diagram', brief: 'Three steps to a clear next step', platform: 'linkedin' });
  type Shape = { image: { id: string; version: number; status: string; sketch: string; sketch_approved: boolean; url: string | null } };

  it('walks the whole pipeline and saves the finished PNG to the bank', async () => {
    const sketched = (await body(await sketchStep())) as unknown as Shape;
    expect(sketched.image).toMatchObject({ status: 'sketch', sketch_approved: false, url: null });
    expect(sketched.image.sketch).toContain('| Name the task |');

    const approved = (await body(
      await step({ action: 'approve', id: sketched.image.id, expected_version: sketched.image.version, request_key: 'ap-1' }),
    )) as unknown as Shape;
    expect(approved.image).toMatchObject({ status: 'sketch', sketch_approved: true });

    const created = (await body(
      await step({ action: 'create', id: approved.image.id, expected_version: approved.image.version, request_key: 'cr-1', platform: 'linkedin' }),
    )) as unknown as Shape;
    expect(created.image.status).toBe('ready');
    expect(created.image.url).toBe(`/api/replies/images/${created.image.id}/file`);

    const file = await readFile(request(created.image.url!, { method: 'GET' }));
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe('image/png');
    expect(renderer.calls).toHaveLength(1);
    expect(renderer.calls[0]!.platform).toBe('linkedin');
    expect(usage.calls.map((call) => call.feature)).toEqual(['ascii_sketch', 'image_render']);
  });

  it('will not render before the sketch is approved', async () => {
    const sketched = (await body(await sketchStep())) as unknown as Shape;
    const response = await step({ action: 'create', id: sketched.image.id, expected_version: sketched.image.version, request_key: 'cr-2', platform: 'linkedin' });
    expect(response.status).toBe(400);
    expect(renderer.calls).toHaveLength(0);
    expect(usage.calls.map((call) => call.feature)).toEqual(['ascii_sketch']);
  });

  it('withdraws an approval when the sketch is revised', async () => {
    const sketched = (await body(await sketchStep())) as unknown as Shape;
    const approved = (await body(await step({ action: 'approve', id: sketched.image.id, expected_version: sketched.image.version, request_key: 'ap-2' }))) as unknown as Shape;
    const revised = (await body(
      await step({ action: 'revise', id: approved.image.id, expected_version: approved.image.version, request_key: 'rv-1', note: 'Make it three blocks', platform: 'linkedin' }),
    )) as unknown as Shape;
    expect(revised.image.sketch_approved).toBe(false);
    const blocked = await step({ action: 'create', id: revised.image.id, expected_version: revised.image.version, request_key: 'cr-3', platform: 'linkedin' });
    expect(blocked.status).toBe(400);
  });

  it('does not render against a version the owner no longer sees', async () => {
    const sketched = (await body(await sketchStep())) as unknown as Shape;
    const approved = (await body(await step({ action: 'approve', id: sketched.image.id, expected_version: sketched.image.version, request_key: 'ap-3' }))) as unknown as Shape;
    const stale = await step({ action: 'create', id: approved.image.id, expected_version: sketched.image.version, request_key: 'cr-4', platform: 'linkedin' });
    expect(stale.status).toBe(409);
    expect(renderer.calls).toHaveLength(0);
  });

  it('is safe to retry: the same key does not bill a second sketch', async () => {
    const first = (await body(await sketchStep('sk-same'))) as unknown as Shape;
    const second = (await body(await sketchStep('sk-same'))) as unknown as Shape;
    expect(second.image.id).toBe(first.image.id);
    expect(usage.calls).toHaveLength(1);
  });

  it('a retry of Create image after it succeeded says it is made, and does not render again', async () => {
    const sketched = (await body(await sketchStep())) as unknown as Shape;
    const approved = (await body(await step({ action: 'approve', id: sketched.image.id, expected_version: sketched.image.version, request_key: 'ap-4' }))) as unknown as Shape;
    const payload = { action: 'create', id: approved.image.id, expected_version: approved.image.version, request_key: 'cr-5', platform: 'linkedin' };
    await step(payload);
    const again = await step(payload);
    expect(again.status).toBe(200);
    expect(renderer.calls).toHaveLength(1);
  });

  it('refuses an unknown action, a bad id and a missing key', async () => {
    expect((await step({ action: 'delete', id: SEED_ID })).status).toBe(400);
    expect((await step({ action: 'approve', id: 'x', expected_version: 1, request_key: 'k' })).status).toBe(400);
    expect((await step({ action: 'sketch', title: 'T', brief: 'B', platform: 'linkedin' })).status).toBe(400);
    expect((await step({ action: 'sketch', request_key: 'k', title: 'T', brief: '', platform: 'linkedin' })).status).toBe(400);
  });

  it('will not run a pipeline step against an uploaded image', async () => {
    const response = await step({ action: 'approve', id: SEED_ID, expected_version: 1, request_key: 'ap-9' });
    expect(response.status).toBe(404);
  });

  it('is refused at the cap with "Monthly AI limit reached" and creates nothing', async () => {
    await usage.setCap({ operationId: '00000000-0000-4000-8000-000000000002', expectedVersion: 1, capMicros: 0, actorHash: 'b'.repeat(64) });
    const before = (await store.listBankImages()).length;
    const response = await sketchStep('sk-cap');
    expect(response.status).toBe(429);
    expect((await body(response)).message).toBe('Monthly AI limit reached');
    expect((await store.listBankImages()).length).toBe(before);
  });

  it('stops at the cap partway: the sketch and approval stand, the render is refused', async () => {
    const sketched = (await body(await sketchStep())) as unknown as Shape;
    const approved = (await body(await step({ action: 'approve', id: sketched.image.id, expected_version: sketched.image.version, request_key: 'ap-5' }))) as unknown as Shape;
    await usage.setCap({ operationId: '00000000-0000-4000-8000-000000000003', expectedVersion: 1, capMicros: 0, actorHash: 'c'.repeat(64) });
    const response = await step({ action: 'create', id: approved.image.id, expected_version: approved.image.version, request_key: 'cr-6', platform: 'linkedin' });
    expect(response.status).toBe(429);
    expect(renderer.calls).toHaveLength(0);
    expect((await store.getBankImage(approved.image.id))!.status).toBe('sketch');
  });
});
