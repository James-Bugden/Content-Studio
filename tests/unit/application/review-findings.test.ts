import { describe, expect, it } from 'vitest';
import { FakeAiGateway } from '@/integrations/ai/fake-gateway';
import { FakeDriveGateway } from '@/integrations/google/fake-drive';
import { FakeSheetTransport } from '@/integrations/google/fake-sheet';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';
import { saveDraft } from '@/application/draft-save';
import { generateHooks, selectHook, type SelectHookInput } from '@/application/hooks';
import { readSection } from '@/application/markdown-source';
import { approveAdaptation, generateAdaptation, saveAdaptation } from '@/application/zh-tw';
import { findSection, headingOutline, sectionBodyProblems } from '@/domain/markdown';
import { fingerprint } from '@/domain/hash';
import { LIBRARY_HEADERS, SHEET_TABS } from '@/domain/sheet-schema';
import { SCHEDULE_ORDER, SYNTH_MASTER_FILE_ID } from '@/fixtures/synthetic';
import type { Actor } from '@/domain/mutation';

/**
 * Regression tests for the independent adversarial review of 2026-09-23.
 * Each case reproduced a real defect before its fix (DRV-02, HOOK-05, ZHTW-04,
 * READY-07, REV-02). Kept permanently so the defects cannot return.
 */
const owner: Actor = { sub: '100000000000000000001', role: 'owner' };
const FENCE = '`'.repeat(3);

describe('finding 1: draft text cannot break the shared master Markdown', () => {
  it.each([
    ['an unclosed code fence', `Hook line.\n\n${FENCE}\nsome code`, 'fence'],
    ['a heading at the section level', 'Hook line.\n\n## SYN-L999 injected section\n\nbody', 'heading'],
    ['a top-level heading', '# New title\n\nbody', 'heading'],
  ])('refuses %s before writing anything', async (_name, proposed, problem) => {
    const sheet = new FakeSheetTransport();
    const repo = new SheetsContentRepository(sheet);
    const drive = new FakeDriveGateway();
    const before = drive.textOf(SYNTH_MASTER_FILE_ID);
    const rec = await repo.getLibrary('SYN-L001');
    const read = await readSection(drive, rec);
    if (!read.ok) throw new Error('read');
    const r = await saveDraft(repo, drive, { operationId: 'op_fence_regr_1', actor: owner, libraryId: 'SYN-L001', expectedSheetRevision: rec.revision, expectedSectionHash: read.section.bodyHash, proposed });
    expect(r).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(sectionBodyProblems(proposed, 2)).toContain(problem);
    expect(drive.textOf(SYNTH_MASTER_FILE_ID)).toBe(before);
    expect(drive.writes).toHaveLength(0);
    expect(sheet.writes).toHaveLength(0);
    for (const id of ['SYN-L001', 'SYN-L005', 'SYN-X004', 'SYN-L008']) expect(findSection(before, id).ok).toBe(true);
  });

  it('still allows balanced fences and lower-level sub-headings inside a section', async () => {
    const sheet = new FakeSheetTransport();
    const repo = new SheetsContentRepository(sheet);
    const drive = new FakeDriveGateway();
    const original = drive.textOf(SYNTH_MASTER_FILE_ID);
    const rec = await repo.getLibrary('SYN-L001');
    const read = await readSection(drive, rec);
    if (!read.ok) throw new Error('read');
    const proposed = `Hook line.\n\n### A sub-point\n\n${FENCE}\n## not a heading inside code\n${FENCE}\n\nEnd.`;
    const r = await saveDraft(repo, drive, { operationId: 'op_fence_regr_2', actor: owner, libraryId: 'SYN-L001', expectedSheetRevision: rec.revision, expectedSectionHash: read.section.bodyHash, proposed });
    expect(r.ok).toBe(true);
    const after = drive.textOf(SYNTH_MASTER_FILE_ID);
    for (const id of ['SYN-L005', 'SYN-X004', 'SYN-L008']) expect(findSection(after, id).ok).toBe(true);
    expect(headingOutline(after).filter((h) => h.startsWith('## '))).toEqual(headingOutline(original).filter((h) => h.startsWith('## ')));
  });
});

describe('finding 2: a stale hook selection never overwrites later Sheet edits', () => {
  it('a replay with a new operation id and the old revision keeps the hand edits', async () => {
    const sheet = new FakeSheetTransport();
    const drive = new FakeDriveGateway();
    const ai = new FakeAiGateway();
    const repoA = new SheetsContentRepository(sheet);
    const record = await repoA.getLibrary('SYN-L001');
    const read = await readSection(drive, record);
    if (!read.ok) throw new Error('no section');
    const g = await generateHooks({ ai, libraryId: 'SYN-L001', platform: 'LinkedIn', currentHook: record.value.currentHook, draft: read.section.body, draftHash: fingerprint(read.section.body) });
    if (!g.ok) throw new Error('gen');
    const input: SelectHookInput = {
      operationId: 'op_first_select_1',
      libraryId: 'SYN-L001',
      expectedSheetRevision: record.revision,
      expectedSectionHash: read.section.bodyHash,
      generationDraftHash: g.proposal.draftHash,
      choice: { kind: 'alternative', index: 1, alternative: g.proposal.alternatives[1]! },
      alternatives: g.proposal.alternatives,
    };
    expect((await selectHook(repoA, drive, owner, input)).ok).toBe(true);
    const grid = sheet.rawTab(SHEET_TABS.library.name);
    const header = grid[0]!.map((c) => c.value);
    const rowIdx = grid.findIndex((r) => r[header.indexOf(LIBRARY_HEADERS.libraryId)]?.value === 'SYN-L001');
    sheet.externalEdit(SHEET_TABS.library.name, rowIdx + 1, header.indexOf(LIBRARY_HEADERS.hookScore), '3');
    sheet.externalEdit(SHEET_TABS.library.name, rowIdx + 1, header.indexOf(LIBRARY_HEADERS.hookType), 'Manual type');
    const repoB = new SheetsContentRepository(sheet);
    const stale = await selectHook(repoB, drive, owner, { ...input, operationId: 'op_stale_tab_2' });
    const after = (await repoB.getLibrary('SYN-L001')).value;
    expect(stale.ok && stale.replayed).toBe(true);
    expect(after.hookScore).toBe(3);
    expect(after.hookType).toBe('Manual type');
  });
});

describe('findings 3 and 4: zh-TW never overwrites a live Threads row or bypasses the X gate', () => {
  it('refuses to save over a published Threads row', async () => {
    const sheet = new FakeSheetTransport();
    const repo = new SheetsContentRepository(sheet);
    const ai = new FakeAiGateway();
    const th = await repo.getSchedule('2026-10-03-MAIN-TH');
    const set = (f: (typeof SCHEDULE_ORDER)[number], v: string) => sheet.externalEdit(SHEET_TABS.schedule.name, th.row, SCHEDULE_ORDER.indexOf(f), v);
    set('typefullyStatus', 'Published');
    set('posted', 'TRUE');
    set('chineseContent', '已發佈的中文貼文');
    set('postLink', 'https://www.threads.net/@synthetic/post/abc');
    const g = await generateAdaptation({ ai, repo, sourceContentId: '2026-10-03-MAIN-X' });
    if (!g.ok) throw new Error(`gen ${g.code}`);
    const p = g.proposal;
    const r = await saveAdaptation(repo, owner, { operationId: 'op_zh_pub_1', threadsContentId: p.threadsContentId, expectedRevision: p.threadsRevision, sourceContentId: p.sourceContentId, sourceHook: p.sourceHook, sourceContent: p.sourceContent, hook: p.hook, content: p.content });
    expect(r).toMatchObject({ ok: false, code: 'GATE_BLOCKED', details: { reason: 'threads_row_in_use' } });
    expect((await repo.getSchedule('2026-10-03-MAIN-TH')).value.chineseContent).toBe('已發佈的中文貼文');
  });

  it('needs explicit takeover for an unlinked Threads row that already holds copy', async () => {
    const sheet = new FakeSheetTransport();
    const repo = new SheetsContentRepository(sheet);
    const ai = new FakeAiGateway();
    const th = await repo.getSchedule('2026-10-03-MAIN-TH');
    sheet.externalEdit(SHEET_TABS.schedule.name, th.row, SCHEDULE_ORDER.indexOf('parentContentId'), '');
    sheet.externalEdit(SHEET_TABS.schedule.name, th.row, SCHEDULE_ORDER.indexOf('chineseContent'), '原生 Threads 貼文');
    const g = await generateAdaptation({ ai, repo, sourceContentId: '2026-10-03-MAIN-X' });
    if (!g.ok) throw new Error(`gen ${g.code}`);
    const p = g.proposal;
    const base = { threadsContentId: p.threadsContentId, expectedRevision: p.threadsRevision, sourceContentId: p.sourceContentId, sourceHook: p.sourceHook, sourceContent: p.sourceContent, hook: p.hook, content: p.content };
    expect(await saveAdaptation(repo, owner, { ...base, operationId: 'op_zh_take_1' })).toMatchObject({ ok: false, code: 'CONFLICT', details: { reason: 'takeover_needs_confirmation' } });
    expect((await saveAdaptation(repo, owner, { ...base, operationId: 'op_zh_take_2', confirmTakeover: true })).ok).toBe(true);
  });

  it('refuses Chinese approval once the X parent is demoted', async () => {
    const sheet = new FakeSheetTransport();
    const repo = new SheetsContentRepository(sheet);
    const ai = new FakeAiGateway();
    const g = await generateAdaptation({ ai, repo, sourceContentId: '2026-10-03-MAIN-X' });
    if (!g.ok) throw new Error(`gen ${g.code}`);
    const p = g.proposal;
    const s = await saveAdaptation(repo, owner, { operationId: 'op_zh_s_1', threadsContentId: p.threadsContentId, expectedRevision: p.threadsRevision, sourceContentId: p.sourceContentId, sourceHook: p.sourceHook, sourceContent: p.sourceContent, hook: p.hook, content: p.content });
    expect(s.ok).toBe(true);
    const x = await repo.getSchedule('2026-10-03-MAIN-X');
    sheet.externalEdit(SHEET_TABS.schedule.name, x.row, SCHEDULE_ORDER.indexOf('contentStage'), 'Drafting');
    const th = await repo.getSchedule(p.threadsContentId);
    const a = await approveAdaptation(repo, owner, { operationId: 'op_zh_a_1', threadsContentId: p.threadsContentId, expectedRevision: th.revision });
    expect(a).toMatchObject({ ok: false, code: 'GATE_BLOCKED' });
    expect((await repo.getSchedule(p.threadsContentId)).value.contentStage).toEqual({ ok: true, value: 'ZH Review' });
  });
});
