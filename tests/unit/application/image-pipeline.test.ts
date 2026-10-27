import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runImageAction, imageState } from '@/application/image-pipeline';
import { runImageBatch, imageDecisionSchema } from '@/domain/image-pipeline';
import { FakeContentDb } from '@/integrations/supabase/fake-content-db';
import { SupabaseContentRepository } from '@/integrations/supabase/content-repository';
import { FakeAiGateway } from '@/integrations/ai/fake-gateway';
import { FakeDriveGateway } from '@/integrations/google/fake-drive';
import { FakeImageRenderer } from '@/integrations/image-renderer/fake';
import { AiUsageService } from '@/application/ai-usage';
import { FakeAiUsageRepository } from '@/integrations/supabase/fake-ai-usage';
import { runVisualAction, toVisualView, renderPreview } from '@/application/visuals';
import type { ImageAction } from '@/domain/image-pipeline';
import type { Actor } from '@/domain/mutation';
import { thumbFor } from '@/domain/next-steps';

const owner: Actor = { sub: 'synthetic-image-owner', role: 'owner' };
let deps: { repo: SupabaseContentRepository; ai: FakeAiGateway; drive: FakeDriveGateway; renderer: FakeImageRenderer };
let seq = 0;
async function act(action: ImageAction['action'], overrides: Partial<ImageAction> = {}) {
  const row = await deps.repo.getLibrary('SYN-L001');
  return runImageAction(deps, owner, { action, libraryId: 'SYN-L001', expectedRevision: row.revision, operationId: `image_test_${++seq}`, ...overrides });
}
beforeEach(() => {
  deps = { repo: new SupabaseContentRepository(new FakeContentDb()), ai: new FakeAiGateway(), drive: new FakeDriveGateway(), renderer: new FakeImageRenderer() };
});
describe('image decision and sketch state', () => {
  it('accepts strict booleans and a single reason only', () => {
    for (const bad of [{ needsImage: 'yes', reason: 'x' }, { needsImage: true, reason: 'a\nb' }, { needsImage: false, reason: '' }, { needsImage: true, reason: 'ok', approve: true }]) expect(imageDecisionSchema.safeParse(bad).success).toBe(false);
  });
  it.each(['LinkedIn', 'Threads', 'X'])('saves the sketch with DB CAS, then approves and uploads PNG for %s', async platform => {
    if (platform !== 'LinkedIn') {
      const original = await deps.repo.getLibrary('SYN-L001');
      await deps.repo.updateLibrary({ actor: owner, operationId: `platform_${++seq}`, target: { libraryId: 'SYN-L001' }, expectedRevision: original.revision, patch: { targetPlatform: platform } });
    }
    const checked = await act('check');
    expect(checked).toMatchObject({ ok: true, image: { approval: 'pending', hasImage: false } });
    const row = await deps.repo.getLibrary('SYN-L001');
    expect(row.value.visual.sketch).toContain('| Name the task |');
    expect(row.cells.hasImage).toBe('TRUE');
    expect(thumbFor('SYN-L001', row.value).src).toBeNull();
    expect(toVisualView(row, [row], []).canRender.ok).toBe(false);
    expect(await runVisualAction(deps.repo, deps.drive, owner, { action: 'render', libraryId: 'SYN-L001', expectedRevision: row.revision, operationId: `no_svg_${++seq}` })).toMatchObject({ ok: false, code: 'GATE_BLOCKED' });
    await expect(renderPreview(deps.repo, 'SYN-L001', 'draft')).rejects.toMatchObject({ code: 'GATE_BLOCKED' });
    expect(await act('create')).toMatchObject({ ok: false, code: 'GATE_BLOCKED' });
    expect(await act('approve')).toMatchObject({ ok: true, image: { approval: 'approved' } });
    expect(await act('create')).toMatchObject({ ok: true, image: { hasImage: true, approval: 'approved' } });
    const rendered = await deps.repo.getLibrary('SYN-L001');
    expect(rendered.cells.imageFile).toContain('drive.google.com');
    expect(rendered.cells.imageStatus).toBe('Needs Review');
    expect(thumbFor('SYN-L001', rendered.value).src).toContain('/asset?');
    expect(deps.renderer.calls).toHaveLength(1);
    const view = toVisualView(rendered, [rendered], []);
    expect(view.reviewable.ok).toBe(true);
    expect(await runVisualAction(deps.repo, deps.drive, owner, { action: 'approve', libraryId: 'SYN-L001', expectedRevision: rendered.revision,
      operationId: `visual_approve_${++seq}`, version: view.version, fileHash: view.fileHash, material: view.material })).toMatchObject({ ok: true, item: { approval: 'approved' } });
  });
  it('writes a text-only decision without calling the sketch model', async () => {
    const row = await deps.repo.getLibrary('SYN-L001');
    await deps.repo.updateLibrary({ actor: owner, operationId: `edit_text_${++seq}`, target: { libraryId: 'SYN-L001' }, expectedRevision: row.revision, patch: { draftContent: '[text-only] Short post.' } });
    expect(await act('check')).toMatchObject({ ok: true, image: { sketch: '', approval: 'none' } });
    expect(deps.ai.requests.map(r => r.task)).toEqual(['image_check']);
    expect((await deps.repo.getLibrary('SYN-L001')).cells).toMatchObject({ hasImage: 'FALSE', imageStatus: 'Not Needed' });
  });
  it('malformed model output leaves existing data untouched', async () => {
    deps.ai.malformedNext(2);
    const before = await deps.repo.getLibrary('SYN-L001');
    expect(await act('check')).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect((await deps.repo.getLibrary('SYN-L001')).revision).toBe(before.revision);
  });
  it('refuses a stale selection before AI, and a concurrent edit after AI', async () => {
    expect(await act('check', { expectedRevision: '0000000000000000' })).toMatchObject({ ok: false, code: 'STALE_READ' });
    expect(deps.ai.requests).toHaveLength(0);
    const original = deps.ai.run.bind(deps.ai);
    vi.spyOn(deps.ai, 'run').mockImplementation(async (task, input, opts) => {
      const output = await original(task, input, opts);
      if (task.name === 'ascii_sketch') {
        const row = await deps.repo.getLibrary('SYN-L001');
        await deps.repo.updateLibrary({ actor: owner, target: { libraryId: 'SYN-L001' }, expectedRevision: row.revision, operationId: `concurrent_${++seq}`, patch: { draftContent: 'A newer owner edit.' } });
      }
      return output;
    });
    expect(await act('check')).toMatchObject({ ok: false, code: 'STALE_READ' });
    expect((await deps.repo.getLibrary('SYN-L001')).value.draftContent).toBe('A newer owner edit.');
  });
  it('makes a pending or approved sketch stale after source edits; revision generates a fresh pending plan', async () => {
    await act('check');
    await act('approve');
    const row = await deps.repo.getLibrary('SYN-L001');
    await deps.repo.updateLibrary({ actor: owner, target: { libraryId: 'SYN-L001' }, expectedRevision: row.revision, operationId: `source_edit_${++seq}`, patch: { draftContent: 'Changed lesson.' } });
    expect(imageState(await deps.repo.getLibrary('SYN-L001')).approval).toBe('stale');
    expect(await act('approve')).toMatchObject({ ok: false, code: 'GATE_BLOCKED' });
    expect(await act('create')).toMatchObject({ ok: false, code: 'GATE_BLOCKED' });
    expect(await act('revise', { note: 'Use two simple steps.' })).toMatchObject({ ok: true, image: { approval: 'pending' } });
    expect(deps.ai.requests.at(-1)?.messages[0]?.content).toContain('Use two simple steps.');
  });
  it('owner only, replay avoids provider work, reused operations conflict', async () => {
    const row = await deps.repo.getLibrary('SYN-L001');
    const input: ImageAction = { action: 'check', libraryId: 'SYN-L001', operationId: `replay_image_${++seq}`, expectedRevision: row.revision };
    expect(await runImageAction(deps, { ...owner, role: 'viewer' }, input)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(await runImageAction(deps, owner, input)).toMatchObject({ ok: true });
    expect(await runImageAction(deps, owner, input)).toMatchObject({ ok: true });
    expect(deps.ai.requests).toHaveLength(2);
    expect(await runImageAction(deps, owner, { ...input, action: 'revise', note: 'change' })).toMatchObject({ ok: false, code: 'CONFLICT' });
  });
  it('refuses an approved sketch after a newer text-only decision or alt-text edit', async () => {
    await act('check'); await act('approve');
    let row = await deps.repo.getLibrary('SYN-L001');
    await deps.repo.updateLibrary({ actor: owner, target: { libraryId: 'SYN-L001' }, expectedRevision: row.revision, operationId: `new_alt_${++seq}`, patch: { imageAltText: 'An owner edit.' } });
    expect(await act('create')).toMatchObject({ ok: false, code: 'GATE_BLOCKED' });
    await act('revise', { note: 'Keep the lesson.' }); await act('approve');
    row = await deps.repo.getLibrary('SYN-L001');
    await deps.repo.updateLibrary({ actor: owner, target: { libraryId: 'SYN-L001' }, expectedRevision: row.revision, operationId: `text_only_${++seq}`, patch: { visualSource: 'Text only' } });
    expect(await act('create')).toMatchObject({ ok: false, code: 'GATE_BLOCKED' });
    expect(deps.renderer.calls).toHaveLength(0);
  });
  it('monthly cap refuses without provider or renderer work', async () => {
    const usageRepo = new FakeAiUsageRepository();
    await usageRepo.setCap({ operationId: crypto.randomUUID(), actorHash: 'a'.repeat(64), expectedVersion: 1, capMicros: 0 });
    deps.ai = new FakeAiGateway(new AiUsageService(usageRepo));
    expect(await act('check')).toEqual({ ok: false, code: 'AI_LIMIT_REACHED', message: 'Monthly AI limit reached' });
    expect(deps.ai.requests).toHaveLength(0);
    expect(deps.renderer.calls).toHaveLength(0);
  });
  it('records image tasks in the shared usage ledger and preserves a prepared upload on retry', async () => {
    const usage = new FakeAiUsageRepository();
    deps.ai = new FakeAiGateway(new AiUsageService(usage));
    await act('check'); await act('approve');
    const row = await deps.repo.getLibrary('SYN-L001');
    const operationId = `image_upload_retry_${++seq}`;
    const original = deps.repo.updateLibrary.bind(deps.repo);
    const fail = vi.spyOn(deps.repo, 'updateLibrary').mockResolvedValueOnce({ ok: false, code: 'PROVIDER_UNAVAILABLE', operationId, steps: [] });
    const input = { action: 'create' as const, libraryId: 'SYN-L001', operationId, expectedRevision: row.revision };
    expect(await runImageAction(deps, owner, input)).toMatchObject({ ok: false });
    fail.mockImplementation(original);
    expect(await runImageAction(deps, owner, input)).toMatchObject({ ok: true });
    expect(deps.drive.created).toHaveLength(1);
    expect(usage.calls.map(c => c.feature)).toEqual(['image_check', 'ascii_sketch', 'image_render']);
    expect(usage.calls.every(c => c.status === 'completed')).toBe(true);
  });
});

describe('bounded bulk runner', () => {
  it('caps at 25 before doing any work', async () => {
    const run = vi.fn();
    await expect(runImageBatch(Array.from({ length: 26 }, (_, i) => ({ libraryId: String(i) })), run, vi.fn(), Boolean)).rejects.toThrow('25');
    expect(run).not.toHaveBeenCalled();
  });
  it('limits concurrency and reports partial failure while completing remaining rows', async () => {
    let active = 0, peak = 0;
    const progress = vi.fn();
    const summary = await runImageBatch(Array.from({ length: 8 }, (_, i) => ({ libraryId: String(i) })), async item => {
      peak = Math.max(peak, ++active);
      await new Promise(resolve => setTimeout(resolve, 2));
      active--;
      if (item.libraryId === '2') throw new Error('partial');
      return item.libraryId !== '4';
    }, progress, Boolean);
    expect(summary).toEqual({ succeeded: 6, failed: 2 });
    expect(peak).toBe(3);
    expect(progress.mock.calls.filter(c => c[1] === 'running')).toHaveLength(8);
  });
});
