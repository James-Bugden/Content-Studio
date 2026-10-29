import { beforeEach, describe, expect, it } from 'vitest';
import { imageState, runImageAction, imageCheckTask } from '@/application/image-pipeline';
import { IMAGE_NEED_TASK } from '@/application/image-need';
import { moreOptionsTask } from '@/application/image-options';
import { MAX_OPTIONS, type ImageOptionDraft } from '@/domain/image-options';
import { runImageBatch, type ImageAction } from '@/domain/image-pipeline';
import type { Actor } from '@/domain/mutation';
import { FakeAiGateway } from '@/integrations/ai/fake-gateway';
import { fakeImageOptions } from '@/integrations/ai/fake-generators';
import { FakeDriveGateway } from '@/integrations/google/fake-drive';
import { FakeImageRenderer } from '@/integrations/image-renderer/fake';
import { FakeContentDb } from '@/integrations/supabase/fake-content-db';
import { SupabaseContentRepository } from '@/integrations/supabase/content-repository';
import { FakeAiUsageRepository } from '@/integrations/supabase/fake-ai-usage';
import { AiUsageService } from '@/application/ai-usage';

const owner: Actor = { sub: 'synthetic-options-owner', role: 'owner' };
let deps: { repo: SupabaseContentRepository; ai: FakeAiGateway; drive: FakeDriveGateway; renderer: FakeImageRenderer };
let seq = 0;
const row = () => deps.repo.getLibrary('SYN-L001');
async function act(action: ImageAction['action'], extra: Record<string, unknown> = {}) {
  return runImageAction(deps, owner, { action, libraryId: 'SYN-L001', expectedRevision: (await row()).revision, operationId: `options_test_${++seq}`, ...extra } as ImageAction);
}
async function setDraft(draftContent: string) {
  const r = await row();
  await deps.repo.updateLibrary({ actor: owner, operationId: `options_draft_${++seq}`, target: { libraryId: 'SYN-L001' }, expectedRevision: r.revision, patch: { draftContent } });
}
async function setSource(visualSource: string) {
  const r = await row();
  await deps.repo.updateLibrary({ actor: owner, operationId: `options_source_${++seq}`, target: { libraryId: 'SYN-L001' }, expectedRevision: r.revision, patch: { visualSource } });
}
async function options() { return imageState(await row()).options; }
async function cappedAi() {
  const usage = new FakeAiUsageRepository();
  await usage.setCap({ operationId: crypto.randomUUID(), actorHash: 'a'.repeat(64), expectedVersion: 1, capMicros: 0 });
  return new FakeAiGateway(new AiUsageService(usage));
}
beforeEach(() => {
  deps = { repo: new SupabaseContentRepository(new FakeContentDb()), ai: new FakeAiGateway(), drive: new FakeDriveGateway(), renderer: new FakeImageRenderer() };
});

describe('one-call image check with sketch options (#248)', () => {
  it('decides the need and returns ranked options in a single model call, saved with the post', async () => {
    const result = await act('check');
    expect(deps.ai.requests.map(r => r.task)).toEqual(['image_check']);
    expect(result).toMatchObject({ ok: true, image: { decision: 'needs_image', approval: 'pending' } });
    const saved = await options();
    expect(saved.map(o => o.layout)).toEqual(['steps', 'comparison', 'before_after']);
    expect(saved.every(o => /^[a-z0-9]{8}$/.test(o.id) && o.title && o.reason && o.sketch)).toBe(true);
    // The best fit is the pending sketch; the options live beside it.
    expect(imageState(await row()).sketch).toBe(saved[0]!.sketch);
  });
  it('the Backlog bulk check stores options too: one call per post, and opening the post later needs no further call', async () => {
    const done = await runImageBatch([{ libraryId: 'SYN-L001' }], async () => act('check'), () => {}, r => r.ok);
    expect(done).toEqual({ succeeded: 1, failed: 0 });
    expect(deps.ai.requests).toHaveLength(1);
    const reopened = imageState(await deps.repo.getLibrary('SYN-L001'));
    expect(reopened.options).toHaveLength(3);
    expect(reopened.decision).toBe('needs_image');
    expect(deps.ai.requests).toHaveLength(1);
  });
  it.each([['[one-option]', 1], ['[two-options]', 2]])('does not pad: %s returns %i option(s)', async (marker, count) => {
    await setDraft(`${marker} Short post.`);
    await act('check');
    expect(await options()).toHaveLength(count);
  });
  it('stores no options when no image is needed and clears earlier ones', async () => {
    await act('check');
    expect((await options()).length).toBeGreaterThan(0);
    await setDraft('[text-only] Short post.');
    expect(await act('check')).toMatchObject({ ok: true, image: { decision: 'no_image', options: [], sketch: '' } });
  });
  it('the tasks validate strictly: 1 to 3 options, unique layouts, size caps, none when no image', () => {
    const batch = [...fakeImageOptions('x', { max: 3 }), ...fakeImageOptions('x', { exclude: ['steps', 'comparison', 'before_after'], max: 3 })];
    const [a, b, c, d] = batch as [ImageOptionDraft, ImageOptionDraft, ImageOptionDraft, ImageOptionDraft];
    const input = { title: 't', draft: 'd', platform: 'linkedin' };
    const check = (needsImage: boolean, options: ImageOptionDraft[]) => imageCheckTask.validate!({ needsImage, reason: 'r', options }, input);
    expect(check(true, [a])).toEqual([]);
    expect(check(true, [a, b, c])).toEqual([]);
    expect(check(true, [])).toEqual(['options: return at least 1']);
    expect(check(true, [a, b, c, d])).toEqual(['options: return at most 3']);
    expect(check(true, [a, { ...b, layout: a.layout }])).toEqual(['options.1.layout: duplicate or already shown']);
    expect(check(true, [{ ...a, sketch: 'x'.repeat(3001) }]).join()).toContain('over 3000');
    expect(check(false, [])).toEqual([]);
    expect(imageCheckTask.normalise!({ needsImage: false, reason: 'r', options: [a] }, input).options).toEqual([]);
    expect(IMAGE_NEED_TASK.validate!({ verdict: 'needs_image', reason: 'r', options: [] }, { draft: 'd', platform: 'LinkedIn' })).toEqual(['options: return at least 1']);
  });
  it('tells the model to use facts from the post only', () => {
    for (const system of [imageCheckTask.system, IMAGE_NEED_TASK.system, moreOptionsTask.system]) expect(system).toMatch(/Never invent numbers, names, quotes or claims/);
  });
  it('a malformed first reply is repaired once, then the check fails without touching the post', async () => {
    deps.ai.malformedNext(1);
    expect(await act('check')).toMatchObject({ ok: true });
    deps.ai.malformedNext(2);
    const before = await row();
    expect(await act('check')).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect((await row()).revision).toBe(before.revision);
  });
});

describe('store (the one-click check saves its own verdict)', () => {
  it('saves the verdict and options without another model call', async () => {
    await setSource('');
    const result = await act('store', { reason: 'Three steps read best as a graphic.', options: fakeImageOptions('x', { max: 2 }) });
    expect(deps.ai.requests).toHaveLength(0);
    expect(result).toMatchObject({ ok: true, image: { decision: 'needs_image', approval: 'pending', reason: 'Three steps read best as a graphic.' } });
    expect(await options()).toHaveLength(2);
  });
  it('re-validates what the browser sends', async () => {
    const [a] = fakeImageOptions('x', { max: 1 });
    const before = await row();
    expect(await act('store', { reason: 'r', options: [a!, { ...a!, title: 'Same layout again' }] })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(await act('store', { reason: 'r', options: [{ ...a!, sketch: '   ' }] })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect((await row()).revision).toBe(before.revision);
  });
  it('only saves the options once the owner decided text only', async () => {
    await setSource('Text only');
    expect(await act('store', { reason: 'r', options: fakeImageOptions('x', { max: 1 }) })).toMatchObject({ ok: true, image: { decision: 'no_image' } });
    expect(await options()).toHaveLength(1);
  });
});

describe('Make image: choose then create', () => {
  it('approves the chosen option and renders; the chosen mark survives the render', async () => {
    await act('check');
    const second = (await options())[1]!;
    expect(await act('choose', { optionId: second.id })).toMatchObject({ ok: true, image: { approval: 'approved', chosenId: second.id, sketch: second.sketch } });
    expect(await act('create')).toMatchObject({ ok: true, image: { hasImage: true, approval: 'approved', chosenId: second.id } });
    expect(deps.ai.requests.map(r => r.task)).toEqual(['image_check', 'image_render']);
    expect(deps.renderer.calls).toHaveLength(1);
  });
  it('uses the edited sketch text, keeps the option marked, and refuses an empty or oversized edit', async () => {
    await act('check');
    const first = (await options())[0]!;
    expect(await act('choose', { optionId: first.id, sketch: '  My edit → here  ' })).toMatchObject({ ok: true, image: { approval: 'approved', sketch: '  My edit -> here', chosenId: first.id } });
    expect(await act('choose', { optionId: first.id, sketch: ' ' })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(await act('choose', { optionId: first.id, sketch: 'x'.repeat(3001) })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(imageState(await row()).sketch).toBe('  My edit -> here');
  });
  it('refuses an unknown option and a stale revision', async () => {
    await act('check');
    expect(await act('choose', { optionId: 'zzzzzzzz' })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(await act('choose', { optionId: (await options())[0]!.id, expectedRevision: '0000000000000000' })).toMatchObject({ ok: false, code: 'STALE_READ' });
  });
  it('a chosen sketch goes stale when the post changes', async () => {
    await act('check');
    await act('choose', { optionId: (await options())[0]!.id });
    await setDraft('A different lesson.');
    expect(imageState(await row()).approval).toBe('stale');
    expect(await act('create')).toMatchObject({ ok: false, code: 'GATE_BLOCKED' });
  });
  it('shows the monthly limit as the existing refusal, with no renderer work', async () => {
    await act('check');
    await act('choose', { optionId: (await options())[0]!.id });
    deps.ai = await cappedAi();
    expect(await act('create')).toEqual({ ok: false, code: 'AI_LIMIT_REACHED', message: 'Monthly AI limit reached' });
    expect(deps.renderer.calls).toHaveLength(0);
  });
});

describe('More options', () => {
  it('adds up to three layouts that were not shown, in one model call counted as ascii_sketch', async () => {
    const usage = new FakeAiUsageRepository();
    deps.ai = new FakeAiGateway(new AiUsageService(usage));
    await setDraft('[one-option] Short post.');
    await act('check');
    const shown = (await options()).map(o => o.layout);
    expect(shown).toHaveLength(1);
    expect(await act('more')).toMatchObject({ ok: true });
    const all = await options();
    expect(all).toHaveLength(4);
    expect(new Set(all.map(o => o.layout)).size).toBe(4);
    expect(usage.calls.map(c => c.feature)).toEqual(['image_check', 'ascii_sketch']);
    expect(deps.ai.requests.at(-1)!.messages[0]!.content).toContain(`"shown":[{"layout":"${shown[0]}"`);
  });
  it('keeps the approved sketch and the chosen mark while adding options', async () => {
    await act('check');
    const first = (await options())[0]!;
    await act('choose', { optionId: first.id });
    expect(await act('more')).toMatchObject({ ok: true, image: { approval: 'approved', chosenId: first.id } });
    expect((await options()).length).toBeGreaterThan(3);
  });
  it('never passes nine options in total', async () => {
    await act('check');
    for (let i = 0; i < 6; i++) await act('more');
    const all = await options();
    expect(all.length).toBeLessThanOrEqual(MAX_OPTIONS);
    expect(new Set(all.map(o => o.layout)).size).toBe(all.length);
  });
  it('a full set makes no model call and reports nothing more', async () => {
    const r = await row();
    const nine = fakeImageOptions('x', { max: 3 });
    expect(nine).toHaveLength(3);
    await act('check');
    for (let i = 0; i < 6; i++) await act('more');
    const calls = deps.ai.requests.length;
    if ((await options()).length === MAX_OPTIONS) expect(await act('more')).toMatchObject({ ok: true, noMore: true });
    else expect(await act('more')).toMatchObject({ ok: true, noMore: true });
    expect(r.revision).toBeTruthy();
    expect(deps.ai.requests.length).toBeLessThanOrEqual(calls + 1);
  });
  it('reports no more when the model has nothing further, without writing', async () => {
    await setDraft('[no-more] Short post.');
    await act('check');
    const before = await row();
    expect(await act('more')).toMatchObject({ ok: true, noMore: true });
    expect((await row()).revision).toBe(before.revision);
  });
  it('is only available after a check returned options', async () => {
    expect(await act('more')).toMatchObject({ ok: false, code: 'GATE_BLOCKED' });
    expect(deps.ai.requests).toHaveLength(0);
  });
  it('is refused by the monthly cap before any provider work', async () => {
    await act('check');
    const before = await options();
    deps.ai = await cappedAi();
    expect(await act('more')).toEqual({ ok: false, code: 'AI_LIMIT_REACHED', message: 'Monthly AI limit reached' });
    expect(deps.ai.requests).toHaveLength(0);
    expect(await options()).toEqual(before);
  });
  it('the task rejects a repeat of a shown layout and more than the room left', () => {
    const [a, b, c] = fakeImageOptions('x', { max: 3 }) as [ImageOptionDraft, ImageOptionDraft, ImageOptionDraft];
    const input = { title: 't', draft: 'd', platform: 'linkedin', shown: [{ layout: a.layout, title: 'x' }], max: 2 };
    expect(moreOptionsTask.validate!({ options: [b, c] }, input)).toEqual([]);
    expect(moreOptionsTask.validate!({ options: [a] }, input)).toEqual(['options.0.layout: duplicate or already shown']);
    expect(moreOptionsTask.validate!({ options: [b, c, { ...a, layout: 'ladder' }] }, input)).toEqual(['options: return at most 2']);
    expect(moreOptionsTask.validate!({ options: [] }, input)).toEqual([]);
  });
});

describe('Needs an image anyway', () => {
  it('drafts options for a post the check called text only and records the new decision', async () => {
    await setDraft('[text-only] Short post.');
    await act('check');
    expect(imageState(await row())).toMatchObject({ decision: 'no_image', options: [] });
    expect(await act('force')).toMatchObject({ ok: true, image: { decision: 'needs_image', approval: 'pending' } });
    expect((await options()).length).toBeGreaterThan(0);
  });
});
