import { beforeEach, describe, expect, it } from 'vitest';
import { FakeAiGateway } from '@/integrations/ai/fake-gateway';
import { FakeSheetTransport } from '@/integrations/google/fake-sheet';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';
import { approveAdaptation, checkEligibility, generateAdaptation, loadAdaptationState, saveAdaptation, type ZhProposal } from '@/application/zh-tw';
import { adaptationState, resolveThreadsRow, threadsIdFor, withZhStamp } from '@/domain/zh-state';
import { missingTerms, paragraphCount, simplifiedCharsIn, zhProblems } from '@/domain/zh-terms';
import { formatZhStamp, parseZhStamp } from '@/domain/stage';
import { SHEET_TABS } from '@/domain/sheet-schema';
import type { Actor } from '@/domain/mutation';
import type { ScheduleRecord } from '@/domain/records';
import { SCHEDULE_ORDER } from '@/fixtures/synthetic';

const owner: Actor = { sub: '100000000000000000001', role: 'owner' };
const SCHEDULE = SHEET_TABS.schedule.name;

let sheet: FakeSheetTransport;
let repo: SheetsContentRepository;
let ai: FakeAiGateway;

beforeEach(() => {
  sheet = new FakeSheetTransport();
  repo = new SheetsContentRepository(sheet);
  ai = new FakeAiGateway();
});

const posts = async () => (await repo.listSchedule()).map((r) => r.value);
const row = async (id: string): Promise<ScheduleRecord> => repo.getSchedule(id);

async function edit(contentId: string, field: (typeof SCHEDULE_ORDER)[number], value: string): Promise<void> {
  const r = await row(contentId);
  sheet.externalEdit(SCHEDULE, r.row, SCHEDULE_ORDER.indexOf(field), value);
}

async function generated(sourceContentId = '2026-10-03-MAIN-X'): Promise<ZhProposal> {
  const r = await generateAdaptation({ ai, repo, sourceContentId });
  if (!r.ok) throw new Error(`generation failed: ${r.code} ${r.reason ?? ''}`);
  return r.proposal;
}

async function save(p: ZhProposal, overrides: Partial<Parameters<typeof saveAdaptation>[2]> = {}) {
  return saveAdaptation(repo, owner, {
    operationId: `op_zh_save_${p.threadsContentId}`,
    threadsContentId: p.threadsContentId,
    expectedRevision: p.threadsRevision,
    sourceContentId: p.sourceContentId,
    sourceHook: p.sourceHook,
    sourceContent: p.sourceContent,
    hook: p.hook,
    content: p.content,
    ...overrides,
  });
}

describe('ZHTW-01: only approved, final X copy is eligible', () => {
  it('EN Approved X with hook and content is eligible', async () => {
    const x = (await row('2026-10-03-MAIN-X')).value;
    expect(checkEligibility(x)).toEqual({ ok: true });
  });

  it.each([
    ['2026-10-03-MAIN-TH', 'not_x'],
    ['2026-10-03-2ND-X', 'stage_unrecognised'],
  ])('%s is blocked (%s)', async (id, reason) => {
    const r = await generateAdaptation({ ai, repo, sourceContentId: id });
    expect(r).toMatchObject({ ok: false, code: 'GATE_BLOCKED', reason });
    expect(ai.requests).toHaveLength(0);
  });

  it('an X row still in EN Review, or missing its hook, is blocked', async () => {
    await edit('2026-10-03-MAIN-X', 'contentStage', 'EN Review');
    expect(await generateAdaptation({ ai, repo, sourceContentId: '2026-10-03-MAIN-X' })).toMatchObject({ ok: false, code: 'GATE_BLOCKED', reason: 'not_en_approved' });
    await edit('2026-10-03-MAIN-X', 'contentStage', 'EN Approved');
    await edit('2026-10-03-MAIN-X', 'hook', '');
    expect(await generateAdaptation({ ai, repo, sourceContentId: '2026-10-03-MAIN-X' })).toMatchObject({ ok: false, code: 'GATE_BLOCKED', reason: 'missing_hook' });
  });

  it('a linked Library row must hold a current approval (stale approval blocks)', async () => {
    expect(await generateAdaptation({ ai, repo, sourceContentId: '2026-10-03-MAIN-X', libraryId: 'SYN-L006' })).toMatchObject({
      ok: false,
      code: 'GATE_BLOCKED',
      reason: 'library_approval_not_current',
    });
    const ok = await generateAdaptation({ ai, repo, sourceContentId: '2026-10-03-MAIN-X', libraryId: 'SYN-X004' });
    expect(ok.ok).toBe(true);
  });

  it('saving is re-gated: an X row moved back to Drafting cannot receive an adaptation', async () => {
    const p = await generated();
    await edit('2026-10-03-MAIN-X', 'contentStage', 'Drafting');
    expect(await save(p)).toMatchObject({ ok: false, code: 'GATE_BLOCKED' });
  });
});

describe('ZHTW-02: Traditional Chinese, Taiwan terminology, meaning kept', () => {
  it('generates Traditional zh-TW with pinned terms and the same paragraph structure', async () => {
    const p = await generated();
    expect(p.hook).toBe('招募人員會先看第一行。');
    expect(p.content).toBe('招募人員會先看第一行。\n\n重點放在求職者身上，而不是薪資。');
    expect(simplifiedCharsIn(p.hook + p.content)).toEqual([]);
    expect(missingTerms(p.sourceContent, p.content)).toEqual([]);
    expect(paragraphCount(p.content)).toBe(paragraphCount(p.sourceContent));
    expect(p.terminologyNotes).toEqual(expect.arrayContaining(['job seeker -> 求職者', 'salary -> 薪資']));
    expect(p.qa).toMatchObject({ meaning: 'pass', terminology: 'pass', taiwanUsage: 'pass' });
    expect(p.sourceStamp).toBe(formatZhStamp('2026-10-03-MAIN-X', p.sourceHook, p.sourceContent));
  });

  it('validation rejects Simplified characters, lost paragraphs and literal term drift', () => {
    const src = { hook: 'Recruiters read the first line.', content: 'Recruiters read the first line.\n\nMake it about the job seeker.\n\nThen stop.' };
    const qa = { meaning: 'pass', naturalness: 'pass', terminology: 'pass', lineBreaks: 'pass', taiwanUsage: 'pass', notes: [] } as const;
    const problems = zhProblems({ hook: '招募人员会先看', content: '这是一段。', terminologyNotes: [], qa: { ...qa, notes: [] } }, src);
    expect(problems).toEqual(
      expect.arrayContaining([
        'hook: contains Simplified-only characters; use Traditional Chinese',
        'content: contains Simplified-only characters; use Traditional Chinese',
        'content: has 1 paragraphs, source has 3',
        'content: glossary term "job seeker" is not rendered as pinned',
      ]),
    );
  });

  it('a Simplified reply is repaired once; two bad replies fail and nothing is written', async () => {
    ai.malformedNext(1);
    expect((await generated()).meta.repaired).toBe(true);
    ai.malformedNext(2);
    expect(await generateAdaptation({ ai, repo, sourceContentId: '2026-10-03-MAIN-X' })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(sheet.writes).toHaveLength(0);
  });
});

describe('ZHTW-03: deterministic Threads linkage', () => {
  it('resolves by Parent Content ID, then by the -X to -TH convention', async () => {
    expect(threadsIdFor('2026-10-01-MAIN-X')).toBe('2026-10-01-MAIN-TH');
    const all = await posts();
    const byParent = resolveThreadsRow('2026-10-01-MAIN-X', all);
    expect(byParent.kind === 'found' && byParent.post.contentId).toBe('2026-10-01-MAIN-TH');
    await edit('2026-10-03-MAIN-TH', 'parentContentId', '');
    const byConvention = resolveThreadsRow('2026-10-03-MAIN-X', await posts());
    expect(byConvention.kind === 'found' && byConvention.post.contentId).toBe('2026-10-03-MAIN-TH');
  });

  it('no candidate is NOT_FOUND; more than one is AMBIGUOUS_MATCH with id/date/slot only', async () => {
    await edit('2026-10-03-MAIN-TH', 'parentContentId', '');
    await edit('2026-10-03-MAIN-TH', 'contentId', '2026-10-03-MAIN-THX');
    expect(await generateAdaptation({ ai, repo, sourceContentId: '2026-10-03-MAIN-X' })).toMatchObject({ ok: false, code: 'NOT_FOUND', reason: 'no_threads_row' });

    await edit('2026-10-03-2ND-TH', 'parentContentId', '2026-10-03-MAIN-X');
    await edit('2026-10-03-MAIN-THX', 'parentContentId', '2026-10-03-MAIN-X');
    const r = await generateAdaptation({ ai, repo, sourceContentId: '2026-10-03-MAIN-X' });
    expect(r).toMatchObject({ ok: false, code: 'AMBIGUOUS_MATCH' });
    if (!r.ok) {
      expect(r.candidates?.map((c) => c.contentId).sort()).toEqual(['2026-10-03-2ND-TH', '2026-10-03-MAIN-THX']);
      expect(Object.keys(r.candidates![0]!).sort()).toEqual(['contentId', 'date', 'slot']);
    }
    expect(adaptationState((await row('2026-10-03-MAIN-X')).value, await posts())).toBe('ambiguous');
    expect(ai.requests).toHaveLength(0);
  });
});

describe('ZHTW-04: lineage, freshness and never touching X', () => {
  it('fixture states: fresh approved, stale after an X edit, missing before adaptation', async () => {
    const all = await posts();
    const x = (id: string) => all.find((p) => p.contentId === id)!;
    expect(adaptationState(x('2026-10-01-MAIN-X'), all)).toBe('approved');
    expect(adaptationState(x('2026-10-02-MAIN-X'), all)).toBe('stale');
    expect(adaptationState(x('2026-10-03-MAIN-X'), all)).toBe('missing');
    expect(await loadAdaptationState(repo, '2026-10-02-MAIN-X')).toEqual({ ok: true, state: 'stale' });
  });

  it('generation writes nothing; saving writes only the Threads row with a fresh stamp', async () => {
    const xBefore = await row('2026-10-03-MAIN-X');
    const p = await generated();
    expect(sheet.writes).toHaveLength(0);
    await edit('2026-10-03-MAIN-TH', 'aiAction', 'Check tone [cs:zh-src:2026-09-30-MAIN-X:deadbeef]');
    const th = await row('2026-10-03-MAIN-TH');
    const r = await save(p, { expectedRevision: th.revision });
    expect(r.ok).toBe(true);
    const saved = (await row('2026-10-03-MAIN-TH')).value;
    expect(saved).toMatchObject({ hook: p.hook, chineseContent: p.content, parentContentId: '2026-10-03-MAIN-X' });
    expect(saved.contentStage).toEqual({ ok: true, value: 'ZH Review' });
    expect(saved.aiAction).toBe(`Check tone ${p.sourceStamp}`);
    expect(parseZhStamp(saved.aiAction)?.parentContentId).toBe('2026-10-03-MAIN-X');
    // The English X row is byte-identical (never replaced).
    expect((await row('2026-10-03-MAIN-X')).revision).toBe(xBefore.revision);
    expect(adaptationState((await row('2026-10-03-MAIN-X')).value, await posts())).toBe('awaiting_review');
  });

  it('an X edit after translation makes the adaptation stale and blocks approval', async () => {
    const p = await generated();
    expect((await save(p)).ok).toBe(true);
    await edit('2026-10-03-MAIN-X', 'content', `${p.sourceContent}\n\nOne more English line.`);
    expect(adaptationState((await row('2026-10-03-MAIN-X')).value, await posts())).toBe('stale');
    const th = await row('2026-10-03-MAIN-TH');
    expect(await approveAdaptation(repo, owner, { operationId: 'op_zh_approve_stale', threadsContentId: '2026-10-03-MAIN-TH', expectedRevision: th.revision })).toMatchObject({
      ok: false,
      code: 'GATE_BLOCKED',
      details: { state: 'stale' },
    });
  });

  it('a late result made from older X copy is discarded on save', async () => {
    const p = await generated();
    await edit('2026-10-03-MAIN-X', 'hook', 'Recruiters skim the first line.');
    expect(await save(p)).toMatchObject({ ok: false, code: 'STALE_READ', details: { reason: 'source_changed' } });
    expect(sheet.writes).toHaveLength(0);
  });

  it('new Chinese copy invalidates an approved Threads image', async () => {
    await edit('2026-10-03-MAIN-TH', 'visualSource', 'Original graphic');
    await edit('2026-10-03-MAIN-TH', 'imageStatus', 'Approved');
    const p = await generated();
    expect((await save(p)).ok).toBe(true);
    expect((await row('2026-10-03-MAIN-TH')).value.visual.imageStatus).toEqual({ ok: true, value: 'Needs Review' });
  });

  it('withZhStamp replaces an old stamp and keeps other text', () => {
    expect(withZhStamp('', '[cs:zh-src:A-X:00000000]')).toBe('[cs:zh-src:A-X:00000000]');
    expect(withZhStamp('Note [cs:zh-src:B-X:11111111] tail', '[cs:zh-src:A-X:00000000]')).toBe('Note tail [cs:zh-src:A-X:00000000]');
  });
});

describe('ZHTW-05: explicit Chinese QA approval', () => {
  it('approval sets Ready only for a fresh adaptation awaiting review', async () => {
    const p = await generated();
    const saved = await save(p);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    // Generation plus a model self-check is never approval.
    expect(adaptationState((await row('2026-10-03-MAIN-X')).value, await posts())).toBe('awaiting_review');
    const r = await approveAdaptation(repo, owner, { operationId: 'op_zh_approve_1', threadsContentId: '2026-10-03-MAIN-TH', expectedRevision: saved.value.revision });
    expect(r.ok).toBe(true);
    expect((await row('2026-10-03-MAIN-TH')).value.contentStage).toEqual({ ok: true, value: 'Ready' });
    expect(adaptationState((await row('2026-10-03-MAIN-X')).value, await posts())).toBe('approved');
  });

  it('approval is refused when missing, already approved, stale or with an old revision', async () => {
    const th = await row('2026-10-03-MAIN-TH');
    expect(await approveAdaptation(repo, owner, { operationId: 'op_zh_approve_2', threadsContentId: '2026-10-03-MAIN-TH', expectedRevision: th.revision })).toMatchObject({ ok: false, code: 'GATE_BLOCKED', details: { state: 'missing' } });
    const pub = await row('2026-10-01-MAIN-TH');
    expect(await approveAdaptation(repo, owner, { operationId: 'op_zh_approve_3', threadsContentId: '2026-10-01-MAIN-TH', expectedRevision: pub.revision })).toMatchObject({ ok: false, code: 'GATE_BLOCKED', details: { state: 'approved' } });
    const stale = await row('2026-10-02-MAIN-TH');
    expect(await approveAdaptation(repo, owner, { operationId: 'op_zh_approve_4', threadsContentId: '2026-10-02-MAIN-TH', expectedRevision: stale.revision })).toMatchObject({ ok: false, code: 'GATE_BLOCKED', details: { state: 'stale' } });
    expect(await approveAdaptation(repo, owner, { operationId: 'op_zh_approve_5', threadsContentId: '2026-10-02-MAIN-TH', expectedRevision: '0000000000000000' })).toMatchObject({ ok: false, code: 'STALE_READ' });
    expect(sheet.writes).toHaveLength(0);
  });

  it('AI failure leaves manual editing usable: a hand-written adaptation saves and approves', async () => {
    ai.failNext('PROVIDER_UNAVAILABLE');
    expect(await generateAdaptation({ ai, repo, sourceContentId: '2026-10-03-MAIN-X' })).toMatchObject({ ok: false, code: 'PROVIDER_UNAVAILABLE' });
    const x = (await row('2026-10-03-MAIN-X')).value;
    const th = await row('2026-10-03-MAIN-TH');
    const manual = await saveAdaptation(repo, owner, {
      operationId: 'op_zh_manual_1',
      threadsContentId: '2026-10-03-MAIN-TH',
      expectedRevision: th.revision,
      sourceContentId: x.contentId,
      sourceHook: x.hook,
      sourceContent: x.content,
      hook: '招募人員先看第一行。',
      content: '招募人員先看第一行。\n\n寫給求職者，不是寫薪資。',
    });
    expect(manual.ok).toBe(true);
    if (!manual.ok) return;
    expect((await approveAdaptation(repo, owner, { operationId: 'op_zh_manual_2', threadsContentId: '2026-10-03-MAIN-TH', expectedRevision: manual.value.revision })).ok).toBe(true);
  });

  it('a Simplified hand edit is refused', async () => {
    const p = await generated();
    expect(await save(p, { content: '招募人员会先看第一行。' })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED', details: { reason: 'simplified_characters' } });
  });
});
