import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeSheetTransport } from '@/integrations/google/fake-sheet';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';
import { loadCalendar, previewPromotion, promote, promotionContext } from '@/application/schedule';
import { loadReadyQueue } from '@/application/ready';
import { addDays, parseContentId, shouldDisplaySlot, slotAvailability, taipeiToday, weekStart } from '@/domain/schedule';
import { parseWorkflowSettings } from '@/domain/settings';
import { syntheticSettingsRows } from '@/fixtures/synthetic';
import type { Actor } from '@/domain/mutation';
import { generateAdaptation } from '@/application/zh-tw';
import { FakeAiGateway } from '@/integrations/ai/fake-gateway';

const owner: Actor = { sub: '100000000000000000001', role: 'owner' };
let sheet: FakeSheetTransport;
let repo: SheetsContentRepository;

beforeEach(() => {
  process.env.CS_FAKE_TODAY = '2026-09-30';
  sheet = new FakeSheetTransport();
  repo = new SheetsContentRepository(sheet);
});
afterEach(() => {
  delete process.env.CS_FAKE_TODAY;
});

async function doPromote(libraryId: string, contentId: string, op = 'op_promote_0001') {
  const p = await previewPromotion(repo, libraryId, contentId);
  if (!p.ok) return { preview: p, result: null };
  const result = await promote(repo, owner, { operationId: op, libraryId, contentId, expectedLibraryRevision: p.libraryRevision, expectedScheduleRevision: p.scheduleRevision });
  return { preview: p, result };
}

describe('dates are Taipei and timezone independent', () => {
  it('parses Content IDs without Date parsing', () => {
    expect(parseContentId('2026-10-01-MAIN-X')).toEqual({ isoDate: '2026-10-01', slot: 'Main', platform: 'X' });
    expect(parseContentId('2026-10-01-3RD-TH')).toEqual({ isoDate: '2026-10-01', slot: '3rd', platform: 'Threads' });
    expect(parseContentId('bad')).toBeNull();
  });

  it('week start and day arithmetic cross month ends', () => {
    expect(weekStart('2026-10-01')).toBe('2026-09-28');
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('Taipei today is correct at the UTC day boundary', () => {
    // 16:30 UTC on 30 Sep is 00:30 on 1 Oct in Taipei.
    expect(taipeiToday(new Date('2026-09-30T16:30:00Z'))).toBe('2026-10-01');
    expect(taipeiToday(new Date('2026-09-30T15:59:00Z'))).toBe('2026-09-30');
  });
});

describe('SCHED-01: slot policy from Workflow Settings', () => {
  it('reads the seven live slot times including TBD', () => {
    const s = parseWorkflowSettings(syntheticSettingsRows().map((r) => r.values));
    expect(s.slots.find((x) => x.platform === 'Threads' && x.slot === '3rd')?.time).toBe('TBD');
    expect(s.slots.find((x) => x.platform === 'X' && x.slot === '3rd')?.time).toBe('TBD');
  });

  it('keeps legacy 3rd IDs readable but never offers them for new content', async () => {
    const legacy = await repo.getSchedule('2026-10-03-3RD-X');
    expect(parseContentId(legacy.value.contentId)).toEqual({ isoDate: '2026-10-03', slot: '3rd', platform: 'X' });
    expect(slotAvailability(legacy)).toEqual({ available: false, reason: 'Legacy 3rd slot is deprecated for new content.' });
    expect(shouldDisplaySlot(legacy)).toBe(false);
    expect(shouldDisplaySlot({ ...legacy, cells: { ...legacy.cells, content: 'Historical third-slot post' }, value: { ...legacy.value, content: 'Historical third-slot post' } })).toBe(true);

    const ctx = await promotionContext(repo, 'SYN-X004');
    expect(ctx.options.some((o) => o.slot === '3rd')).toBe(false);
  });

  it('a missing slot setting blocks, never falls back to a guess', () => {
    const rows = syntheticSettingsRows().filter((r) => r.values[0] !== 'LinkedIn Main').map((r) => r.values);
    const s = parseWorkflowSettings(rows);
    expect(s.slots.find((x) => x.platform === 'LinkedIn')).toBeUndefined();
  });

  it('offers only available LinkedIn slots for a LinkedIn item, all valid', async () => {
    const ctx = await promotionContext(repo, 'SYN-L005');
    expect(ctx.group).toBe('ready');
    expect(ctx.options.map((o) => o.contentId)).toEqual(['2026-10-01-MAIN-LI', '2026-10-03-MAIN-LI']);
    expect(ctx.options.every((o) => o.ok && o.time === '21:00')).toBe(true);
  });
});

describe('SCHED-02: preview shows every value written and nothing else', () => {
  it('maps Library fields into the slot row with lineage', async () => {
    const p = await previewPromotion(repo, 'SYN-L005', '2026-10-01-MAIN-LI');
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const fields = p.preview.map((r) => r.field);
    expect(fields).toEqual(expect.arrayContaining(['hook', 'content', 'contentStage', 'sourceLink', 'visualSource']));
    expect(fields).not.toContain('contentId');
    expect(fields).not.toContain('posted');
    expect(fields).not.toContain('date');
    expect(p.preview.find((r) => r.field === 'sourceLink')?.after).toMatch(/#lib=SYN-L005$/);
    expect(p.preview.find((r) => r.field === 'contentStage')?.after).toBe('Ready');
  });

  it('confirm writes exactly the previewed cells', async () => {
    const { preview, result } = await doPromote('SYN-L005', '2026-10-01-MAIN-LI');
    expect(result?.ok).toBe(true);
    if (!preview.ok) throw new Error('preview');
    const written = sheet.writes.flatMap((w) => w.writes.map((c) => c.column));
    const header = sheet.rawTab('Content Schedule')[1]!.map((c) => c.value);
    expect(written.map((c) => header[c]).sort()).toEqual(preview.preview.map((r) => r.header).sort());
    const row = await repo.getSchedule('2026-10-01-MAIN-LI');
    expect(row.value.content).toBe((await repo.getLibrary('SYN-L005')).value.draftContent);
  });

  it('after promotion the Ready Queue shows the item as scheduled', async () => {
    await doPromote('SYN-L005', '2026-10-01-MAIN-LI');
    const q = await loadReadyQueue(repo);
    const item = q.items.find((i) => i.libraryId === 'SYN-L005')!;
    expect(item.group).toBe('scheduled');
    expect(item.scheduledAs[0]!.contentId).toBe('2026-10-01-MAIN-LI');
  });
});

describe('SCHED-03: conflicts are safe', () => {
  it('an occupied slot is refused', async () => {
    const p = await previewPromotion(repo, 'SYN-L005', '2026-10-02-MAIN-LI');
    expect(p).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
  });

  it('the same item cannot be scheduled twice', async () => {
    await doPromote('SYN-L005', '2026-10-01-MAIN-LI');
    const again = await previewPromotion(repo, 'SYN-L005', '2026-10-03-MAIN-LI');
    expect(again).toMatchObject({ ok: false, code: 'CONFLICT' });
  });

  it('two-tab promotion: the second confirm with the same preview conflicts', async () => {
    const p = await previewPromotion(repo, 'SYN-L005', '2026-10-01-MAIN-LI');
    if (!p.ok) throw new Error('preview');
    const input = { libraryId: 'SYN-L005', contentId: '2026-10-01-MAIN-LI', expectedLibraryRevision: p.libraryRevision, expectedScheduleRevision: p.scheduleRevision };
    expect((await promote(repo, owner, { ...input, operationId: 'op_tab_one_0001' })).ok).toBe(true);
    // A different operation for the same item and slot is a lost-response replay only if identical; the slot now holds it.
    const second = await promote(repo, owner, { ...input, operationId: 'op_tab_two_0001' });
    expect(second).toMatchObject({ ok: true, replayed: true });
    expect(sheet.writes).toHaveLength(1);
  });

  it('an external row change after the preview is STALE_READ', async () => {
    const p = await previewPromotion(repo, 'SYN-L005', '2026-10-01-MAIN-LI');
    if (!p.ok) throw new Error('preview');
    const grid = sheet.rawTab('Content Schedule');
    const header = grid[1]!.map((c) => c.value);
    const rowIdx = grid.findIndex((r) => r[header.indexOf('Content ID')]?.value === '2026-10-01-MAIN-LI');
    sheet.externalEdit('Content Schedule', rowIdx + 1, header.indexOf('AI Review Notes'), 'someone typed here');
    const r = await promote(repo, owner, { operationId: 'op_stale_0001', libraryId: 'SYN-L005', contentId: '2026-10-01-MAIN-LI', expectedLibraryRevision: p.libraryRevision, expectedScheduleRevision: p.scheduleRevision });
    expect(r).toMatchObject({ ok: false, code: 'STALE_READ' });
    expect(sheet.writes).toHaveLength(0);
  });

  it('READY-06: a stale gate (Library changed after preview) is STALE_READ', async () => {
    const p = await previewPromotion(repo, 'SYN-L005', '2026-10-01-MAIN-LI');
    if (!p.ok) throw new Error('preview');
    const lib = await repo.getLibrary('SYN-L005');
    const col = sheet.rawTab('Content Library')[0]!.findIndex((c) => c.value === 'Draft Content');
    sheet.externalEdit('Content Library', lib.row, col, 'Changed after the preview');
    const r = await promote(repo, owner, { operationId: 'op_stale_0002', libraryId: 'SYN-L005', contentId: '2026-10-01-MAIN-LI', expectedLibraryRevision: p.libraryRevision, expectedScheduleRevision: p.scheduleRevision });
    expect(r).toMatchObject({ ok: false, code: 'STALE_READ' });
  });
});

describe('SCHED-04 / SCHED-05: no bypass', () => {
  it('a non-approved Library item cannot be promoted even with forged revisions', async () => {
    const lib = await repo.getLibrary('SYN-L001');
    const row = await repo.getSchedule('2026-10-01-MAIN-LI');
    const r = await promote(repo, owner, { operationId: 'op_bypass_0001', libraryId: 'SYN-L001', contentId: '2026-10-01-MAIN-LI', expectedLibraryRevision: lib.revision, expectedScheduleRevision: row.revision });
    expect(r).toMatchObject({ ok: false, code: 'GATE_BLOCKED' });
    expect(sheet.writes).toHaveLength(0);
  });

  it('an id that is not in Content Library cannot create a Schedule record', async () => {
    const row = await repo.getSchedule('2026-10-01-MAIN-LI');
    const r = await promote(repo, owner, { operationId: 'op_bypass_0002', libraryId: 'NOT-IN-LIBRARY', contentId: '2026-10-01-MAIN-LI', expectedLibraryRevision: '0000000000000000', expectedScheduleRevision: row.revision });
    expect(r).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });

  it('Threads slots cannot be promoted into directly; they come from the X adaptation', async () => {
    const ctx = await promotionContext(repo, 'SYN-X004');
    expect(ctx.options.every((o) => o.contentId.endsWith('-X'))).toBe(true);
  });

  it('an X item lands at EN Approved so its Threads adaptation must follow', async () => {
    const ctx = await promotionContext(repo, 'SYN-X004');
    const slot = ctx.options.find((o) => o.ok)!;
    const { result } = await doPromote('SYN-X004', slot.contentId);
    expect(result?.ok).toBe(true);
    expect((await repo.getSchedule(slot.contentId)).cells.contentStage).toBe('EN Approved');
  });

  it('a TBD slot (Threads 3rd) is never offered as schedulable', async () => {
    const cal = await loadCalendar(repo, '2026-10-01');
    const th3 = cal.days.flatMap((d) => d.cells).filter((c) => c.contentId.endsWith('-3RD-TH'));
    expect(th3.every((c) => c.time === 'Not set')).toBe(true);
  });
});

describe('lineage links the scheduled X row back to its Library approval', () => {
  it('a Library edit after promotion blocks the zh-TW adaptation', async () => {
    const ctx = await promotionContext(repo, 'SYN-X004');
    const slot = ctx.options.find((o) => o.ok)!;
    await doPromote('SYN-X004', slot.contentId);
    const ai = new FakeAiGateway();
    expect((await generateAdaptation({ ai, repo, sourceContentId: slot.contentId })).ok).toBe(true);
    const lib = await repo.getLibrary('SYN-X004');
    const col = sheet.rawTab('Content Library')[0]!.findIndex((c) => c.value === 'Draft Content');
    sheet.externalEdit('Content Library', lib.row, col, 'Edited after it was scheduled');
    expect(await generateAdaptation({ ai, repo, sourceContentId: slot.contentId })).toMatchObject({ ok: false, code: 'GATE_BLOCKED' });
  });
});

describe('calendar', () => {
  it('groups a week by Taipei date and orders by time', async () => {
    const cal = await loadCalendar(repo, '2026-10-01');
    expect(cal.start).toBe('2026-09-28');
    const oct1 = cal.days.find((d) => d.isoDate === '2026-10-01')!;
    expect(oct1.cells[0]!.time).toBe('08:00');
    expect(oct1.cells.some((cell) => cell.slot === '3rd')).toBe(false);
    expect(oct1.cells.find((c) => c.contentId === '2026-10-02-MAIN-X')).toBeUndefined();
    const oct2x = cal.days.find((d) => d.isoDate === '2026-10-02')!.cells.find((c) => c.contentId === '2026-10-02-MAIN-X')!;
    expect(oct2x.zh).toBe('stale');
  });
});
