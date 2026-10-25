import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getServices, resetServices } from '@/application/container';
import { resetEnvCache } from '@/lib/env';
import { saveDraft } from '@/application/draft-save';
import { repairContentExport } from '@/lib/content-maintenance';
import { fingerprint } from '@/domain/hash';
import { SYNTH_MASTER_FILE_ID } from '@/fixtures/synthetic';
import { findSection, safeReplaceSectionBody } from '@/domain/markdown';
import { buildReconcileReport } from '@/application/reconcile';

beforeEach(() => {
  vi.stubEnv('CS_DATA_MODE', 'fake'); vi.stubEnv('CS_CONTENT_STORE', 'db'); vi.stubEnv('VERCEL_ENV', 'preview');
  resetEnvCache(); resetServices();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); resetEnvCache(); resetServices(); });
async function save(body = 'Synthetic DB rollback body', id = 'SYN-L008') {
  const s = getServices(), row = await s.repo.getLibrary(id);
  return saveDraft(s.repo, s.drive, { actor: { role: 'owner', sub: 'synthetic-owner' }, operationId: `synthetic_rollback_${body.length}_${id}`,
    libraryId: id, expectedSheetRevision: row.revision, expectedSectionHash: fingerprint(row.value.draftContent), proposed: body });
}

it.each([false, true])('composed DB-7 rollback succeeds on the untouched fixture / after edit and export: %s', async edited => {
  const s = getServices();
  await s.contentCutover!.exporter.run();
  if (edited) {
    expect((await save()).ok).toBe(true);
    await s.markdownExport!.run();
    expect(await s.fakes!.db.pendingMarkdownExports()).toEqual([]);
  }
  const flip = vi.fn();
  const result = await s.contentCutover!.rollbackToSheet(flip);
  expect(result.parity.exact).toBe(true); expect(flip).toHaveBeenCalledExactlyOnceWith('sheet');
  expect(s.repo.capability().state).toBe('read_only');
});

it.each([false, true])('unexported DB body refuses rollback and restores the previous write state (already disabled: %s)', async frozen => {
  const s = getServices(); await s.contentCutover!.exporter.run();
  expect((await save()).ok).toBe(true);
  s.fakes!.drive.failNext({ op: 'read', code: 'NOT_FOUND', times: 10 });
  if (frozen) await s.contentCutover!.disableWrites();
  const flip = vi.fn();
  await expect(s.contentCutover!.rollbackToSheet(flip)).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'rollback_markdown_export_pending' } });
  expect(flip).not.toHaveBeenCalled(); expect(await s.fakes!.db.pendingMarkdownExports()).toHaveLength(1);
  expect(s.repo.capability().state).toBe(frozen ? 'read_only' : 'ready');
  expect((await save('A later save')).ok).toBe(!frozen);
});

it('rollback compares body bytes even after the job was acknowledged; refuses without freezing writes', async () => {
  const s = getServices(); await s.contentCutover!.exporter.run();
  expect((await save()).ok).toBe(true); await s.markdownExport!.run();
  const text = s.fakes!.drive.textOf(SYNTH_MASTER_FILE_ID), found = findSection(text, 'SYN-L008');
  if (!found.ok) throw new Error('fixture');
  s.fakes!.drive.externalEdit(SYNTH_MASTER_FILE_ID, safeReplaceSectionBody(text, found.section, 'Unqueued Drive edit')!);
  const flip = vi.fn();
  await expect(s.contentCutover!.rollbackToSheet(flip)).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'rollback_markdown_not_exact', libraryId: 'SYN-L008' } });
  expect(flip).not.toHaveBeenCalled(); expect(s.repo.capability().state).toBe('ready');
});

it.each(['missing', 'duplicate'])('a previously exported DB body with a now %s section is blocking and named', async problem => {
  const s = getServices(); await s.contentCutover!.exporter.run();
  expect((await save()).ok).toBe(true); await s.markdownExport!.run();
  const text = s.fakes!.drive.textOf(SYNTH_MASTER_FILE_ID);
  s.fakes!.drive.externalEdit(SYNTH_MASTER_FILE_ID, problem === 'missing' ? text.replace('SYN-L008', 'SYN-REMOVED') : text + '\n\n## SYN-L008\n\nDuplicate body');
  const flip = vi.fn();
  await expect(s.contentCutover!.rollbackToSheet(flip)).rejects.toMatchObject({ details: { libraryId: 'SYN-L008' } });
  expect(flip).not.toHaveBeenCalled(); expect(s.repo.capability().state).toBe('ready');
  const report = await buildReconcileReport(s.repo, s.drive, undefined, { markdownExport: s.markdownExport });
  expect(report.items.find(i => i.kind === 'markdown_missing' && i.stableIds.includes('SYN-L008'))).toMatchObject({ severity: 'blocking', facts: [expect.stringContaining('export the exact saved body')] });
});

it('a pending job still blocks rollback when its body matches Drive but its acknowledgment fails', async () => {
  const s = getServices(); await s.contentCutover!.exporter.run();
  expect((await save()).ok).toBe(true);
  vi.spyOn(s.fakes!.db, 'completeMarkdownExport').mockRejectedValue(new Error('Synthetic unavailable acknowledgment'));
  await s.markdownExport!.run();
  const flip = vi.fn();
  await expect(s.contentCutover!.rollbackToSheet(flip)).rejects.toMatchObject({ details: { reason: 'rollback_markdown_export_pending' } });
  expect(flip).not.toHaveBeenCalled(); expect(s.repo.capability().state).toBe('ready');
});

it('attempts Sheet repair even if reading the Markdown queue throws, and reports the failure', async () => {
  const s = getServices();
  vi.spyOn(s.markdownExport!, 'run').mockRejectedValue(new Error('Synthetic queue failure'));
  const sheet = vi.spyOn(s.contentCutover!.exporter, 'run');
  await expect(repairContentExport()).rejects.toThrow('Synthetic queue failure');
  expect(sheet).toHaveBeenCalledOnce(); expect((await s.contentCutover!.exporter.parity()).exact).toBe(true);
});

it('CS-059j: unreadable untouched legacy masters refuse rollback', async () => {
  const s = getServices(); await s.contentCutover!.exporter.run();
  s.fakes!.drive.failNext({ op: 'read', code: 'PROVIDER_UNAVAILABLE', times: 100 });
  const flip = vi.fn();
  await expect(s.contentCutover!.rollbackToSheet(flip)).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'rollback_markdown_not_exact' } });
  expect(flip).not.toHaveBeenCalled(); expect(s.repo.capability().state).toBe('ready');
});
