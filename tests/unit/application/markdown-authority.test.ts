import { beforeEach, describe, expect, it, vi } from 'vitest';
import { databaseBodyRepository, MarkdownExporter } from '@/application/markdown-export';
import { importMarkdownSection, previewMarkdownImport } from '@/application/markdown-import';
import { FakeAiGateway } from '@/integrations/ai/fake-gateway';
import { generateHooks, selectHook } from '@/application/hooks';
import { saveDraft } from '@/application/draft-save';
import { loadEditor } from '@/application/editor';
import { buildReconcileReport } from '@/application/reconcile';
import { FakeContentDb } from '@/integrations/supabase/fake-content-db';
import { SupabaseContentRepository } from '@/integrations/supabase/content-repository';
import { FakeDriveGateway } from '@/integrations/google/fake-drive';
import { findSection, safeReplaceSectionBody } from '@/domain/markdown';
import { fingerprint } from '@/domain/hash';
import { SYNTH_MASTER_FILE_ID } from '@/fixtures/synthetic';

const owner = { sub: 'synthetic-owner', role: 'owner' as const };
let db: FakeContentDb, drive: FakeDriveGateway, repo: ReturnType<typeof databaseBodyRepository>, exporter: MarkdownExporter;
beforeEach(() => {
  db = new FakeContentDb(); drive = new FakeDriveGateway();
  repo = databaseBodyRepository(new SupabaseContentRepository(db));
  exporter = new MarkdownExporter(repo, drive, db);
});
async function save(body: string, operationId = 'synthetic_save_draft') {
  const row = await repo.getLibrary('SYN-L008');
  return saveDraft(repo, drive, { actor: owner, libraryId: 'SYN-L008', operationId,
    expectedSheetRevision: row.revision, expectedSectionHash: fingerprint(row.value.draftContent), proposed: body });
}
async function hookInput() {
  const row = await repo.getLibrary('SYN-L001');
  const generated = await generateHooks({ ai: new FakeAiGateway(), libraryId: 'SYN-L001', platform: 'LinkedIn', currentHook: row.value.currentHook,
    draft: row.value.draftContent, draftHash: fingerprint(row.value.draftContent) });
  if (!generated.ok) throw new Error('generation');
  return { operationId: 'synthetic_hook_guard', libraryId: 'SYN-L001', expectedSheetRevision: row.revision,
    expectedSectionHash: fingerprint(row.value.draftContent), generationDraftHash: fingerprint(row.value.draftContent), alternatives: generated.proposal.alternatives,
    choice: { kind: 'alternative' as const, index: 0, alternative: generated.proposal.alternatives[0]! } };
}

describe('DB-7 atomic body and export', () => {
  it('saves and loads with no Drive reads, even when Drive is down; queues lag and repairs later', async () => {
    const read = vi.spyOn(drive, 'readText');
    drive.failNext({ op: 'read', code: 'NOT_FOUND' });
    const result = await save('Synthetic body 🙂');
    expect(result.ok).toBe(true);
    expect(result.steps.every(step => step.provider === 'db')).toBe(true);
    const model = await loadEditor(repo, drive, 'SYN-L008');
    expect(model.markdown).toMatchObject({ state: 'ok', body: 'Synthetic body 🙂' });
    expect(model.mismatch).toBe(false); expect(read).not.toHaveBeenCalled();
    await exporter.run();
    expect(exporter.failures.get('SYN-L008')?.code).toBe('NOT_FOUND');
    expect(await db.pendingMarkdownExports()).toHaveLength(1);
    const report = await buildReconcileReport(repo, drive);
    expect(report.items.some(item => item.kind === 'markdown_export_lag' && item.stableIds.includes('SYN-L008'))).toBe(true);
    expect(report.items.some(item => item.kind === 'markdown_mismatch')).toBe(false);
    await exporter.run(); expect(await db.pendingMarkdownExports()).toEqual([]);
  });
  it('DRV-01 exports exact UTF-8 body and keeps all adjacent bytes; a repeat writes nothing', async () => {
    const before = drive.textOf(SYNTH_MASTER_FILE_ID);
    const found = findSection(before, 'SYN-L008'); if (!found.ok) throw new Error('fixture');
    const body = '測試 🙂\r\n\r\n  indentation\t\ntrailing spaces   ';
    expect((await save(body)).ok).toBe(true);
    expect(drive.writes).toHaveLength(0);
    await exporter.run();
    const after = drive.textOf(SYNTH_MASTER_FILE_ID);
    const actual = findSection(after, 'SYN-L008'); if (!actual.ok) throw new Error('lost section');
    expect(Buffer.from(actual.section.body)).toEqual(Buffer.from(body));
    expect(after.slice(0, actual.section.bodyStart)).toBe(before.slice(0, found.section.bodyStart));
    expect(after.slice(actual.section.bodyEnd)).toBe(before.slice(found.section.bodyEnd));
    await exporter.run(); expect(drive.writes).toHaveLength(1);
  });
  it('never overwrites a hand-edited section; provider revision and whole-file readback are checked', async () => {
    const text = drive.textOf(SYNTH_MASTER_FILE_ID), found = findSection(text, 'SYN-L008');
    if (!found.ok) throw new Error('fixture');
    await save('Database body');
    drive.externalEdit(SYNTH_MASTER_FILE_ID, safeReplaceSectionBody(text, found.section, 'External body')!);
    await exporter.run(); expect(drive.writes).toHaveLength(0);
    expect(exporter.failures.get('SYN-L008')?.code).toBe('CONFLICT');
    expect((await repo.getLibrary('SYN-L008')).value.draftContent).toBe('Database body');
  });
  it('coalesces two saves without replacing the original export baseline', async () => {
    const old = (await repo.getLibrary('SYN-L008')).value.draftContent;
    await save('First body'); await save('Second body', 'synthetic_second_save');
    const jobs = await db.pendingMarkdownExports();
    expect(jobs).toHaveLength(1); expect(jobs[0]).toMatchObject({ expectedBody: old, body: 'Second body' });
    await exporter.run(); expect(await db.pendingMarkdownExports()).toEqual([]);
    expect(drive.writes).toHaveLength(1);
  });
  it('completion of an older export retains a newer save, and duplicate completion cannot regress its baseline', async () => {
    await save('First body'); const first = (await db.pendingMarkdownExports())[0]!;
    await save('Second body', 'synthetic_second_save');
    await db.completeMarkdownExport(first);
    expect((await db.pendingMarkdownExports())[0]).toMatchObject({ body: 'Second body', expectedBody: 'First body' });
    await db.completeMarkdownExport(first);
    expect((await db.pendingMarkdownExports())[0]?.expectedBody).toBe('First body');
  });
  it('passes the fresh Drive revision and retains the job after an unverified whole-file write', async () => {
    await save('Database body');
    const revision = (await drive.getMeta(SYNTH_MASTER_FILE_ID)).revision;
    const write = vi.spyOn(drive, 'writeText');
    const read = drive.readText.bind(drive);
    let calls = 0;
    vi.spyOn(drive, 'readText').mockImplementation(async id => {
      const result = await read(id);
      if (++calls === 2) result.text += '\nSynthetic concurrent adjacent edit';
      return result;
    });
    await exporter.run();
    expect(write.mock.calls[0]?.[2]).toBe(revision);
    expect(exporter.failures.get('SYN-L008')?.code).toBe('CONFLICT');
    expect(await db.pendingMarkdownExports()).toHaveLength(1);
    const report = await buildReconcileReport(repo, drive, undefined, { markdownExport: exporter });
    expect(report.items.find(item => item.kind === 'markdown_export_lag' && item.stableIds.includes('SYN-L008'))?.severity).toBe('blocking');
    await exporter.run(); expect(await db.pendingMarkdownExports()).toEqual([]);
    expect(drive.writes).toHaveLength(1);
  });
  it('blocks returning to Drive authority while any saved body is unexported', async () => {
    await save('Database body');
    drive.failNext({ op: 'read', code: 'NOT_FOUND' });
    await expect(exporter.verifyRollback()).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await db.pendingMarkdownExports()).toHaveLength(1);
  });
  it('refuses stale, viewer and invalid saves, and replays an approved-body save without a second patch', async () => {
    db.externalEdit('library', 'SYN-L008', { review_status: 'Approved' });
    const row = await repo.getLibrary('SYN-L008');
    const input = { actor: owner, operationId: 'synthetic_approved_save', libraryId: 'SYN-L008', expectedSheetRevision: row.revision, expectedSectionHash: fingerprint(row.value.draftContent), proposed: 'New approved body' };
    expect((await saveDraft(repo, drive, input)).ok).toBe(true);
    expect((await repo.getLibrary('SYN-L008')).cells.reviewStatus).toBe('Not Reviewed');
    const history = db.history.length;
    expect(await saveDraft(repo, drive, input)).toMatchObject({ ok: true, replayed: true });
    expect(db.history).toHaveLength(history);
    expect(await saveDraft(repo, drive, { ...input, operationId: 'synthetic_stale_save', proposed: 'Other body' })).toMatchObject({ ok: false, code: 'STALE_READ' });
    expect(await saveDraft(repo, drive, { ...input, actor: { ...owner, role: 'viewer' } })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });
  it('hook choice changes metadata and opening atomically with Drive unavailable and replays once', async () => {
    const row = await repo.getLibrary('SYN-L001');
    const body = row.value.draftContent;
    const generated = await generateHooks({ ai: new FakeAiGateway(), libraryId: 'SYN-L001', platform: 'LinkedIn', currentHook: row.value.currentHook, draft: body, draftHash: fingerprint(body) });
    if (!generated.ok) throw new Error('generation');
    const alternative = generated.proposal.alternatives[0]!;
    const input = { operationId: 'synthetic_db_hook', libraryId: 'SYN-L001', expectedSheetRevision: row.revision,
      expectedSectionHash: fingerprint(body), generationDraftHash: fingerprint(body), alternatives: generated.proposal.alternatives,
      choice: { kind: 'alternative' as const, index: 0, alternative } };
    drive.failNext({ op: 'read', code: 'NOT_FOUND' });
    const before = db.history.length;
    const result = await selectHook(repo, drive, owner, input);
    expect(result.ok).toBe(true);
    expect(db.history.length - before).toBe(1);
    expect(db.history.at(-1)?.changed_fields).toContain('draft_content');
    const after = await repo.getLibrary('SYN-L001');
    expect(after.value.currentHook).toBe(alternative.text);
    expect(after.value.draftContent).toBe(alternative.text + body.slice(row.value.currentHook.length));
    expect(drive.writes).toHaveLength(0);
    expect(await selectHook(repo, drive, owner, input)).toMatchObject({ ok: true, replayed: true });
    expect(db.history.length - before).toBe(1);
  });
  it.each(['generationDraftHash', 'expectedSectionHash'] as const)('refuses stale DB hook %s even with a fresh row revision', async field => {
    const input = await hookInput(); input[field] = fingerprint('Stale generation');
    for (const choice of [input.choice, { kind: 'current' as const }]) {
      expect(await selectHook(repo, drive, owner, { ...input, choice })).toMatchObject({ ok: false, code: 'STALE_READ' });
    }
    expect(db.history).toEqual([]); expect(await db.pendingMarkdownExports()).toEqual([]);
  });
  it.each(['Wrong opening', 'suffix', 'blank'])('refuses DB hook opening mismatch: %s', async problem => {
    const row = await repo.getLibrary('SYN-L001');
    db.externalEdit('library', 'SYN-L001', problem === 'blank' ? { current_hook: '' }
      : { draft_content: problem === 'suffix' ? row.value.currentHook + 'suffix\nBody' : 'Different opening\nBody' });
    const input = await hookInput(), before = await repo.getLibrary('SYN-L001'), history = db.history.length;
    expect(await selectHook(repo, drive, owner, input)).toMatchObject({ ok: false, code: 'CONFLICT', details: { reason: 'opening_mismatch' } });
    expect(await repo.getLibrary('SYN-L001')).toEqual(before); expect(db.history).toHaveLength(history);
    expect(await db.pendingMarkdownExports()).toEqual([]);
  });
  it.each(['## New section\n\ntext', 'Body\n```text\nopen fence'])('refuses unsafe structure at save, with the existing Sheet error and no DB or Drive write: %s', async body => {
    const before = await repo.getLibrary('SYN-L008');
    const reads = vi.spyOn(drive, 'readText');
    expect(await save(body)).toMatchObject({ ok: false, code: 'VALIDATION_FAILED', details: { reason: 'unsafe_markdown_structure' } });
    expect(await repo.getLibrary('SYN-L008')).toEqual(before);
    expect(db.history).toEqual([]); expect(await db.pendingMarkdownExports()).toEqual([]);
    expect(reads).not.toHaveBeenCalled(); expect(drive.writes).toEqual([]);
  });
  it('refuses an adjacent Drive edit between the export read and write without overwriting it', async () => {
    await save('Database body');
    const read = drive.readText.bind(drive);
    let external = '';
    vi.spyOn(drive, 'readText').mockImplementationOnce(async id => {
      const snapshot = await read(id);
      const other = findSection(snapshot.text, 'SYN-L001'); if (!other.ok) throw new Error('fixture');
      external = safeReplaceSectionBody(snapshot.text, other.section, 'Hand edit in another section')!;
      drive.externalEdit(id, external);
      return snapshot;
    });
    await exporter.run();
    expect(drive.textOf(SYNTH_MASTER_FILE_ID)).toBe(external);
    expect(drive.writes).toEqual([]);
    expect(await exporter.status()).toMatchObject([{ libraryId: 'SYN-L008', code: 'STALE_READ' }]);
    expect(await db.pendingMarkdownExports()).toHaveLength(1);
  });
  it('does not acknowledge a matching readback body with a different revision', async () => {
    await save('Database body');
    const read = drive.readText.bind(drive); let calls = 0;
    vi.spyOn(drive, 'readText').mockImplementation(async id => {
      const result = await read(id);
      if (++calls === 2) result.meta.revision = 'unexpected-revision';
      return result;
    });
    await exporter.run();
    expect(await db.pendingMarkdownExports()).toHaveLength(1);
    expect(exporter.failures.get('SYN-L008')?.code).toBe('CONFLICT');
  });
  it('names a stale queued snapshot as blocking and repairs it after an audited save', async () => {
    await save('Queued body');
    db.externalEdit('library', 'SYN-L008', { draft_content: 'Out of band body' });
    await exporter.run();
    expect(drive.writes).toEqual([]); expect(await db.pendingMarkdownExports()).toHaveLength(1);
    const report = await buildReconcileReport(repo, drive, undefined, { markdownExport: exporter });
    expect(report.items.find(i => i.kind === 'markdown_export_lag' && i.stableIds.includes('SYN-L008'))).toMatchObject({ severity: 'blocking',
      facts: [expect.stringContaining('queued body differs')], action: { href: '/review/SYN-L008' } });
    await save('Chosen recovery body', 'synthetic_recovery_save');
    await exporter.run();
    expect(await db.pendingMarkdownExports()).toEqual([]); expect(exporter.failures.has('SYN-L008')).toBe(false);
    expect((await buildReconcileReport(repo, drive, undefined, { markdownExport: exporter })).items.filter(i => i.kind === 'markdown_export_lag')).toEqual([]);
  });
  it('does not mistake missing legacy sections for export lag; no-link and unreadable masters are distinct', async () => {
    const report = await buildReconcileReport(repo, drive, undefined, { markdownExport: exporter });
    expect(report.items.filter(i => i.kind === 'markdown_export_lag')).toEqual([]);
    expect(report.items.find(i => i.kind === 'markdown_missing' && i.stableIds.includes('SYN-L003'))?.severity).toBe('attention');
    db.externalEdit('library', 'SYN-L008', { source_markdown_url: '', source_master_file_url: '', source_markdown: '', source_master_file: '' });
    const missing = await buildReconcileReport(repo, drive, undefined, { markdownExport: exporter });
    expect(missing.items.find(i => i.stableIds.includes('SYN-L008') && i.kind === 'markdown_missing')).toMatchObject({ title: 'SYN-L008: no Drive master link' });
    drive.failNext({ op: 'read', code: 'PROVIDER_UNAVAILABLE', times: 10 });
    const unreadable = await buildReconcileReport(repo, drive, undefined, { markdownExport: exporter });
    expect(unreadable.items.some(i => i.kind === 'markdown_export_lag' && i.title.includes('could not be checked'))).toBe(true);
  });
});

describe('previewed Markdown import', () => {
  it('reports duplicate refusals and exact differs flags, and refuses a trashed master', async () => {
    await save('Different DB body');
    const result = await previewMarkdownImport(repo, drive, owner, SYNTH_MASTER_FILE_ID);
    expect(result.refused).toEqual(['SYN-L003']);
    expect(result.sections.find(s => s.libraryId === 'SYN-L008')?.differs).toBe(true);
    expect(result.sections.find(s => s.libraryId === 'SYN-L001')?.differs).toBe(false);
    drive.trash(SYNTH_MASTER_FILE_ID);
    await expect(previewMarkdownImport(repo, drive, owner, SYNTH_MASTER_FILE_ID)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('imports a new marker/labelled master by Library ID without changing export destinations', async () => {
    const master = 'SYNTH_new_intake_master';
    const source = '### Synthetic post\r\n<!-- POST_START library_id="SYN-L008" -->\r\nDecision: PENDING\r\n#### Draft\r\n\r\nExact new body 🙂  \r\n\r\n<!-- POST_END -->\r\n\r\n## Another post\r\nLibrary ID: SYN-L001\r\n### Working draft\r\n```text\r\nLabelled body\r\n```\r\n';
    const intake = new FakeDriveGateway({ [master]: source });
    const preview = await previewMarkdownImport(repo, intake, owner, master);
    expect(preview.sections.map(section => section.libraryId).sort()).toEqual(['SYN-L001', 'SYN-L008']);
    const section = preview.sections.find(section => section.libraryId === 'SYN-L008')!;
    expect(section.markdownBody).toBe('Exact new body 🙂  ');
    const links = (await repo.getLibrary(section.libraryId)).links;
    const result = await importMarkdownSection(repo, intake, owner, { operationId: 'synthetic_marker_import', libraryId: section.libraryId,
      expectedRevision: section.expectedRevision, sectionHash: section.sectionHash, markdownBody: section.markdownBody,
      fileId: master, fileRevision: preview.fileRevision, direction: 'markdown_to_db' });
    expect(result.ok).toBe(true);
    expect((await repo.getLibrary(section.libraryId)).links).toEqual(links);
    expect(intake.writes).toHaveLength(0);
  });
  async function preview() {
    const result = await previewMarkdownImport(repo, drive, owner, SYNTH_MASTER_FILE_ID);
    const section = result.sections.find(section => section.libraryId === 'SYN-L008')!;
    return { operationId: 'synthetic_import_section', libraryId: section.libraryId, expectedRevision: section.expectedRevision,
      fileId: result.fileId, fileRevision: result.fileRevision, sectionHash: section.sectionHash, markdownBody: section.markdownBody, direction: 'markdown_to_db' };
  }
  it('matches sections by Library ID, refuses missing confirmation, imports exact bytes once and replays', async () => {
    await save('DB differs'); const input = await preview();
    expect(input.markdownBody).not.toBe('DB differs');
    await expect(importMarkdownSection(repo, drive, owner, { ...input, direction: undefined })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect((await repo.getLibrary('SYN-L008')).value.draftContent).toBe('DB differs');
    expect(await importMarkdownSection(repo, drive, owner, input)).toMatchObject({ ok: true });
    const count = db.history.length;
    expect(await importMarkdownSection(repo, drive, owner, input)).toMatchObject({ ok: true, replayed: true });
    expect(db.history).toHaveLength(count);
    expect((await repo.getLibrary('SYN-L008')).value.draftContent).toBe(input.markdownBody);
    expect(drive.writes).toHaveLength(0);
  });
  it('refuses a noncanonical file id or a body token that does not describe the preview', async () => {
    const input = await preview();
    await expect(importMarkdownSection(repo, drive, owner, { ...input, fileId: `https://drive.google.com/file/d/${input.fileId}/view` })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(importMarkdownSection(repo, drive, owner, { ...input, sectionHash: fingerprint('Other body') })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(db.history).toEqual([]);
  });
  it('keeps DB on the explicit keep direction, refuses stale Drive/DB previews and viewer/non-db use', async () => {
    await save('DB body'); const input = await preview();
    expect(await importMarkdownSection(repo, drive, owner, { ...input, direction: 'keep_db' })).toMatchObject({ ok: true, kept: true });
    expect((await repo.getLibrary('SYN-L008')).value.draftContent).toBe('DB body');
    await save('Newer DB body', 'synthetic_newer_body');
    expect(await importMarkdownSection(repo, drive, owner, input)).toMatchObject({ ok: false, code: 'STALE_READ' });
    drive.externalEdit(SYNTH_MASTER_FILE_ID, drive.textOf(SYNTH_MASTER_FILE_ID) + '\n');
    await expect(importMarkdownSection(repo, drive, owner, input)).rejects.toMatchObject({ code: 'STALE_READ' });
    await expect(previewMarkdownImport(repo, drive, { ...owner, role: 'viewer' }, SYNTH_MASTER_FILE_ID)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(previewMarkdownImport(new SupabaseContentRepository(db), drive, owner, SYNTH_MASTER_FILE_ID)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

it('CS-059j: level-4 draft refuses a level-3 heading on export and retains the exact master and pending job', async () => {
  const baseline = (await repo.getLibrary('SYN-L008')).value.draftContent;
  const master = `# Synthetic master\n\n## Post\n\n<!-- POST_START library_id="SYN-L008" -->\n\n#### Draft\n\n${baseline}\n\n<!-- POST_END -->\n\n## Neighbour\n\nUntouched`;
  drive.externalEdit(SYNTH_MASTER_FILE_ID, master);
  const found = findSection(master, 'SYN-L008');
  expect(found.ok && found.section.level).toBe(4);
  expect((await save('intro\n### Deeper heading\nmore')).ok).toBe(true);
  await exporter.run();
  expect(exporter.failures.get('SYN-L008')?.code).toBe('VALIDATION_FAILED');
  expect(await db.pendingMarkdownExports()).toHaveLength(1);
  expect(drive.writes).toHaveLength(0);
  expect(drive.textOf(SYNTH_MASTER_FILE_ID)).toBe(master);
});
it('CS-059j: unqueued Drive/DB body difference is blocking', async () => {
  const text = drive.textOf(SYNTH_MASTER_FILE_ID), found = findSection(text, 'SYN-L008');
  if (!found.ok) throw new Error('fixture');
  drive.externalEdit(SYNTH_MASTER_FILE_ID, safeReplaceSectionBody(text, found.section, 'Synthetic drift')!);
  const report = await buildReconcileReport(repo, drive, undefined, { markdownExport: exporter });
  expect(report.items.find(i => i.kind === 'markdown_export_lag' && i.stableIds.includes('SYN-L008'))?.severity).toBe('blocking');
});
