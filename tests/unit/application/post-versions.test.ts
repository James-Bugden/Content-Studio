import { describe, it, expect, vi } from 'vitest';
import { FakeContentDb } from '@/integrations/supabase/fake-content-db';
import { SupabaseContentRepository } from '@/integrations/supabase/content-repository';
import { databaseOnlyRepository } from '@/application/database-only';
import { savePostVersions, changePostLifecycle, proposePostChinese } from '@/application/post-versions';
import { FakeAiGateway } from '@/integrations/ai/fake-gateway';
import { fingerprint } from '@/domain/hash';
import { fewerLineBreaks } from '@/domain/format';

const owner = { sub: 'synthetic-owner', role: 'owner' as const };
const id = 'SYN-L001';
function setup(writable = true) {
  const db = new FakeContentDb();
  return { db, repo: databaseOnlyRepository(new SupabaseContentRepository(db), writable) };
}

describe('post version and lifecycle contract', () => {
  it('saves only selected platform versions atomically with exact English and Chinese; retries replay', async () => {
    const { db, repo } = setup();
    const before = await repo.getLibrary(id);
    const proposed = 'Synthetic English.\n\n  Exact spacing 🙂';
    const input = { operationId: 'synthetic_versions', expectedRevision: before.revision, proposed, platforms: ['LinkedIn', 'X'] as ('LinkedIn' | 'X')[], chinese: { source: proposed, content: '繁體中文草稿。' } };
    const first = await savePostVersions(repo, owner, id, input);
    expect(first.ok).toBe(true);
    expect(await savePostVersions(repo, owner, id, input)).toEqual({ ...first, replayed: true });
    expect((await repo.getLibrary(id)).value.draftContent).toBe(proposed);
    const saved = await repo.postProperties!(id);
    expect(saved.versions).toEqual(input.platforms.map(platform => ({ platform, english: proposed, chinese: input.chinese.content, sourceHash: fingerprint(proposed) })));
    expect(db.history).toHaveLength(1);
    expect(db.audit).toHaveLength(1);
    expect(await savePostVersions(repo, owner, id, { ...input, platforms: ['Threads'] })).toMatchObject({ ok: false, code: 'CONFLICT' });
    expect(await savePostVersions(repo, owner, id, { ...input, operationId: 'synthetic_stale', proposed: 'Another edit', chinese: undefined })).toMatchObject({ ok: false, code: 'STALE_READ' });
  });

  it('saves a chosen hook with the text in one revision', async () => {
    const { db, repo } = setup();
    const before = await repo.getLibrary(id);
    const input = { operationId: 'synthetic_hook_with_text', expectedRevision: before.revision, proposed: 'Synthetic hook line\n\nBody.', currentHook: 'Synthetic hook line', platforms: ['LinkedIn'] as ['LinkedIn'] };
    const saved = await savePostVersions(repo, owner, id, input);
    expect(saved.ok).toBe(true);
    const after = await repo.getLibrary(id);
    expect(after.value.currentHook).toBe('Synthetic hook line');
    expect(after.value.draftContent).toBe('Synthetic hook line\n\nBody.');
    expect(db.history).toHaveLength(1);
    expect(await savePostVersions(repo, owner, id, input)).toMatchObject({ ok: true, replayed: true });
  });

  it('refuses stale Chinese and unsafe Markdown without writing', async () => {
    const { db, repo } = setup();
    const before = await repo.getLibrary(id);
    const input = { operationId: 'synthetic_invalid', expectedRevision: before.revision, proposed: 'New English', platforms: ['X'] as ['X'], chinese: { source: 'Old English', content: '中文' } };
    await expect(savePostVersions(repo, owner, id, input)).rejects.toMatchObject({ code: 'STALE_READ' });
    await expect(savePostVersions(repo, owner, id, { ...input, proposed: '## Unsafe section', chinese: undefined })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(db.history).toHaveLength(0);
  });

  it('deletes from warm lists and point reads, blocks edits, and restores exact content', async () => {
    const { repo, db } = setup();
    const before = await repo.getLibrary(id);
    await repo.listLibrary(); // Warm cache must be invalidated by deletion.
    const input = { operationId: 'synthetic_delete', expectedRevision: before.revision, action: 'delete' as const, deletedAt: new Date().toISOString() };
    const deleted = await changePostLifecycle(repo, owner, id, input);
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) return;
    expect((await repo.listLibrary()).some(r => r.value.libraryId === id)).toBe(false);
    await expect(repo.getLibrary(id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await repo.updateLibrary({ operationId: 'synthetic_tombstone_edit', actor: owner, target: { libraryId: id }, expectedRevision: deleted.value.revision, patch: { draftContent: 'Overwrite' } })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(await changePostLifecycle(repo, owner, id, input)).toEqual({ ...deleted, replayed: true });
    const restore = { operationId: 'synthetic_restore', expectedRevision: deleted.value.revision, action: 'restore' as const };
    expect(await changePostLifecycle(repo, owner, id, restore)).toMatchObject({ ok: true });
    expect((await repo.getLibrary(id)).value).toEqual(before.value);
    expect(db.history).toHaveLength(2);
  });

  it('refuses stale deletes, expired restores, viewers and the write freeze', async () => {
    const { repo, db } = setup();
    const before = await repo.getLibrary(id);
    db.externalEdit('library', id, { current_hook: 'Synthetic newer hook' });
    const input = { operationId: 'synthetic_delete_old', expectedRevision: before.revision, action: 'delete' as const, deletedAt: new Date().toISOString() };
    expect(await changePostLifecycle(repo, owner, id, input)).toMatchObject({ ok: false, code: 'STALE_READ' });
    await expect(changePostLifecycle(repo, { ...owner, role: 'viewer' }, id, input)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    db.externalEdit('library', id, { deleted_at: new Date(Date.now() - 31_000).toISOString() });
    const tombstone = await repo.postProperties!(id);
    expect(await changePostLifecycle(repo, owner, id, { operationId: 'synthetic_expired', expectedRevision: tombstone.revision, action: 'restore' })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    const frozen = setup(false).repo;
    expect(await changePostLifecycle(frozen, owner, id, input)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });

  it('reuses the Chinese task without writing or changing the English source', async () => {
    const { repo, db } = setup();
    const ai = new FakeAiGateway();
    const run = vi.spyOn(ai, 'run');
    const source = 'A synthetic English source.';
    expect((await proposePostChinese(repo, ai, id, source)).ok).toBe(true);
    expect(run.mock.calls[0]![0].name).toBe('zh_tw');
    expect(db.history).toHaveLength(0);
  });

  it('compacts prose only on request while keeping paragraphs and lists', () => {
    expect(fewerLineBreaks('First line\nsecond line\n\n• one\n• two\n\nLast.')).toBe('First line second line\n\n• one\n• two\n\nLast.');
  });

  it('can save an empty draft without granting a release approval', async () => {
    const { repo } = setup();
    const before = await repo.getLibrary(id);
    expect(await savePostVersions(repo, owner, id, { operationId: 'synthetic_empty_draft', expectedRevision: before.revision, proposed: '', platforms: ['X'] })).toMatchObject({ ok: true });
    const after = await repo.getLibrary(id);
    expect(after.value.draftContent).toBe('');
    expect(after.value.reviewStatus).toMatchObject({ ok: true, value: 'Pending' });
  });
});
