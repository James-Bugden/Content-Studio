import { beforeEach, describe, expect, it } from 'vitest';
import { FakeSheetTransport } from '@/integrations/google/fake-sheet';
import { FakeDriveGateway } from '@/integrations/google/fake-drive';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';
import { saveDraft, type DraftSaveInput } from '@/application/draft-save';
import { readSection, markdownFileId } from '@/application/markdown-source';
import { previewAsset } from '@/application/assets';
import { findSection, fingerprint, parseDriveFileId } from '@/domain';
import { SYNTH_MARKDOWN, SYNTH_MASTER_FILE_ID } from '@/fixtures/synthetic';
import type { Actor } from '@/domain/mutation';

const owner: Actor = { sub: '100000000000000000001', role: 'owner' };
let sheet: FakeSheetTransport;
let repo: SheetsContentRepository;
let drive: FakeDriveGateway;

beforeEach(() => {
  sheet = new FakeSheetTransport();
  repo = new SheetsContentRepository(sheet);
  drive = new FakeDriveGateway();
});

async function load(libraryId: string) {
  const record = await repo.getLibrary(libraryId);
  const read = await readSection(drive, record);
  if (!read.ok) throw new Error(`section ${read.reason}`);
  return { record, read };
}

function input(libraryId: string, record: { revision: string }, sectionHash: string, proposed: string, n = '1'): DraftSaveInput {
  return { operationId: `op_save_${libraryId}_${n}`, actor: owner, libraryId, expectedSheetRevision: record.revision, expectedSectionHash: sectionHash, proposed };
}

describe('links', () => {
  it.each([
    ['https://drive.google.com/file/d/SYNTH_master_negotiation_md/view', 'SYNTH_master_negotiation_md'],
    ['https://docs.google.com/document/d/SYNTH_doc_abcdefghijk/edit', 'SYNTH_doc_abcdefghijk'],
    ['https://drive.google.com/open?id=SYNTH_open_abcdefghijkl', 'SYNTH_open_abcdefghijkl'],
    ['SYNTH_master_negotiation_md', 'SYNTH_master_negotiation_md'],
    ['Open master', null],
    ['Negotiations', null],
    ['https://evil.example.com/file/d/SYNTH_master_negotiation_md/view', null],
    ['javascript:alert(1)', null],
    ['http://drive.google.com/file/d/SYNTH_master_negotiation_md/view', null],
  ])('%s -> %s', (raw, expected) => {
    expect(parseDriveFileId(raw)).toBe(expected);
  });

  it('resolves the master file from the Open master hyperlink', async () => {
    expect(markdownFileId(await repo.getLibrary('SYN-L001'))).toBe(SYNTH_MASTER_FILE_ID);
  });
});

describe('DRV-01 / REV-07: exact round trip through the saga', () => {
  it('saves CJK, emoji, whitespace and line breaks exactly, adjacent sections byte-equal', async () => {
    const { record, read } = await load('SYN-L008');
    const proposed = '談薪水不是吵架 🙂\n\n  indented line\t\nlast line with trailing spaces   ';
    const r = await saveDraft(repo, drive, input('SYN-L008', record, read.section.bodyHash, proposed));
    expect(r.ok).toBe(true);
    expect(r.steps.map((s) => [s.provider, s.status])).toEqual([['drive', 'done'], ['sheet', 'done']]);
    const after = drive.textOf(SYNTH_MASTER_FILE_ID);
    const section = findSection(after, 'SYN-L008');
    if (!section.ok) throw new Error('lost');
    expect(section.section.body).toBe(proposed);
    expect((await repo.getLibrary('SYN-L008')).value.draftContent).toBe(proposed);
    const before = SYNTH_MARKDOWN[SYNTH_MASTER_FILE_ID]!;
    const orig = findSection(before, 'SYN-L008');
    if (!orig.ok) throw new Error('lost');
    expect(after.slice(0, section.section.bodyStart)).toBe(before.slice(0, orig.section.bodyStart));
    expect(after.slice(section.section.bodyEnd)).toBe(before.slice(orig.section.bodyEnd));
  });

  it('saving an approved item resets it to Not Reviewed', async () => {
    const { record, read } = await load('SYN-L005');
    expect(record.value.reviewStatus).toEqual({ ok: true, value: 'Approved' });
    const r = await saveDraft(repo, drive, input('SYN-L005', record, read.section.bodyHash, 'Changed after approval.'));
    expect(r.ok).toBe(true);
    expect((await repo.getLibrary('SYN-L005')).cells.reviewStatus).toBe('Not Reviewed');
  });
});

describe('DRV-02 / REV-08: unsafe writes are refused', () => {
  it('external Drive edit to the same section is STALE_READ with the current text', async () => {
    const { record, read } = await load('SYN-L001');
    drive.externalEdit(SYNTH_MASTER_FILE_ID, read.text.replace('Scope decides the salary band.', 'Edited in Drive.'));
    const r = await saveDraft(repo, drive, input('SYN-L001', record, read.section.bodyHash, 'Mine'));
    expect(r).toMatchObject({ ok: false, code: 'STALE_READ', conflict: { provider: 'drive' } });
    expect(r.conflict?.current).toContain('Edited in Drive.');
    expect(drive.writes).toHaveLength(0);
    expect(sheet.writes).toHaveLength(0);
  });

  it('external edit to a different section is merged safely by replacing only ours', async () => {
    const { record, read } = await load('SYN-L001');
    drive.externalEdit(SYNTH_MASTER_FILE_ID, read.text.replace('Ask what changed.', 'Ask what changed, calmly.'));
    const r = await saveDraft(repo, drive, input('SYN-L001', record, read.section.bodyHash, 'Mine'));
    expect(r.ok).toBe(true);
    expect(drive.textOf(SYNTH_MASTER_FILE_ID)).toContain('Ask what changed, calmly.');
  });

  it('external Sheet edit is STALE_READ with the current Sheet text', async () => {
    const { record, read } = await load('SYN-L001');
    const col = sheet.rawTab('Content Library')[0]!.findIndex((c) => c.value === 'Draft Content');
    sheet.externalEdit('Content Library', record.row, col, 'Edited in the Sheet');
    const r = await saveDraft(repo, drive, input('SYN-L001', record, read.section.bodyHash, 'Mine'));
    expect(r).toMatchObject({ ok: false, code: 'STALE_READ', conflict: { provider: 'sheet', current: 'Edited in the Sheet' } });
    expect(drive.writes).toHaveLength(0);
  });

  it.each([
    ['missing section', (d: FakeDriveGateway) => d.externalEdit(SYNTH_MASTER_FILE_ID, '# Empty master\n'), 'NOT_FOUND'],
    ['moved file', (d: FakeDriveGateway) => d.remove(SYNTH_MASTER_FILE_ID), 'NOT_FOUND'],
    ['trashed file', (d: FakeDriveGateway) => d.trash(SYNTH_MASTER_FILE_ID), 'NOT_FOUND'],
    ['permission failure', (d: FakeDriveGateway) => d.failNext({ op: 'read', code: 'FORBIDDEN' }), 'FORBIDDEN'],
  ] as const)('%s makes no write', async (_name, mutate, code) => {
    const record = await repo.getLibrary('SYN-L001');
    mutate(drive);
    const r = await saveDraft(repo, drive, input('SYN-L001', record, '0000000000000000', 'Mine'));
    expect(r).toMatchObject({ ok: false, code });
    expect(drive.writes).toHaveLength(0);
    expect(sheet.writes).toHaveLength(0);
  });

  it('duplicate Library-ID sections are refused', async () => {
    const record = await repo.getLibrary('SYN-L003');
    const r = await saveDraft(repo, drive, input('SYN-L003', record, '0000000000000000', 'Mine'));
    expect(r).toMatchObject({ ok: false, code: 'CONFLICT', details: { reason: 'duplicate_section' } });
    expect(drive.writes).toHaveLength(0);
  });
});

describe('DRV-03 / DRV-04: partial failures are explicit and retryable', () => {
  it('Drive success then Sheet failure is PARTIAL_FAILURE; retry completes without a second Drive write', async () => {
    const { record, read } = await load('SYN-L001');
    sheet.failNext({ op: 'write', code: 'PROVIDER_UNAVAILABLE' });
    const first = await saveDraft(repo, drive, input('SYN-L001', record, read.section.bodyHash, 'Mine'));
    expect(first).toMatchObject({ ok: false, code: 'PARTIAL_FAILURE' });
    expect(first.steps.map((s) => s.status)).toEqual(['done', 'failed']);
    const retry = await saveDraft(repo, drive, input('SYN-L001', record, read.section.bodyHash, 'Mine'));
    expect(retry.ok).toBe(true);
    expect(retry.steps.map((s) => s.status)).toEqual(['skipped_already_applied', 'done']);
    expect(drive.writes).toHaveLength(1);
  });

  it('Sheet already mirrored but Drive write fails is PARTIAL_FAILURE, not success', async () => {
    const { record, read } = await load('SYN-L001');
    const col = sheet.rawTab('Content Library')[0]!.findIndex((c) => c.value === 'Draft Content');
    sheet.externalEdit('Content Library', record.row, col, 'Mine');
    drive.failNext({ op: 'write', code: 'PROVIDER_UNAVAILABLE' });
    const r = await saveDraft(repo, drive, input('SYN-L001', record, read.section.bodyHash, 'Mine'));
    expect(r).toMatchObject({ ok: false, code: 'PARTIAL_FAILURE' });
    expect(r.steps.map((s) => [s.provider, s.status])).toEqual([['drive', 'failed'], ['sheet', 'pending']]);
  });

  it('Drive failure alone writes nothing and is not partial', async () => {
    const { record, read } = await load('SYN-L001');
    drive.failNext({ op: 'write', code: 'RATE_LIMITED' });
    const r = await saveDraft(repo, drive, input('SYN-L001', record, read.section.bodyHash, 'Mine'));
    expect(r).toMatchObject({ ok: false, code: 'RATE_LIMITED' });
    expect(sheet.writes).toHaveLength(0);
  });

  it('a fully applied save replays as already applied', async () => {
    const { record, read } = await load('SYN-L001');
    await saveDraft(repo, drive, input('SYN-L001', record, read.section.bodyHash, 'Mine'));
    const again = await saveDraft(repo, drive, input('SYN-L001', record, read.section.bodyHash, 'Mine'));
    expect(again).toMatchObject({ ok: true, replayed: true });
    expect(drive.writes).toHaveLength(1);
  });

  it('pins the documented residual race window between the revision check and the upload', async () => {
    const { record, read } = await load('SYN-L001');
    drive.beforeWrite = () => drive.externalEdit(SYNTH_MASTER_FILE_ID, read.text.replace('Ask what changed.', 'Racing edit.'));
    // The fake checks the revision before invoking beforeWrite, so this models the residual window:
    // the gateway's own check passed, the racing edit lands, and our write then replaces the file.
    const r = await saveDraft(repo, drive, input('SYN-L001', record, read.section.bodyHash, 'Mine'));
    // Our section is correct after the write; the racing edit to another section is lost.
    // This is the documented atomicity limit, and the test pins it so it cannot silently grow.
    expect(r.ok).toBe(true);
    expect(drive.textOf(SYNTH_MASTER_FILE_ID)).not.toContain('Racing edit.');
  });
});

describe('SEC-04 / VIS-01: inert content and safe previews', () => {
  it('script and injection text in Markdown remain plain data', async () => {
    const { read } = await load('SYN-L001');
    expect(read.text).toContain('<script>');
    expect(read.section.body).not.toContain('<script>');
    expect(fingerprint(read.section.body)).toBe(read.section.bodyHash);
  });

  it('serves a real PNG with the sniffed type', async () => {
    const r = await previewAsset(drive, 'SYNTH_asset_researched_range_r02.png');
    expect(r.contentType).toBe('image/png');
  });

  it.each([
    ['SVG', 'SYNTH_asset_script.svg', 'VALIDATION_FAILED'],
    ['Markdown pretending to be an asset', SYNTH_MASTER_FILE_ID, 'VALIDATION_FAILED'],
    ['foreign URL', 'https://evil.example.com/a.png', 'VALIDATION_FAILED'],
  ])('refuses %s', async (_name, ref, code) => {
    await expect(previewAsset(drive, ref)).rejects.toMatchObject({ code });
  });
});
