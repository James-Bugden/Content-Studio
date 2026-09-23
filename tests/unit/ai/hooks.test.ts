import { beforeEach, describe, expect, it } from 'vitest';
import { FakeAiGateway } from '@/integrations/ai/fake-gateway';
import { FakeDriveGateway } from '@/integrations/google/fake-drive';
import { FakeSheetTransport } from '@/integrations/google/fake-sheet';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';
import { generateHooks, HOOK_TASK, selectHook, type HookProposal, type SelectHookInput } from '@/application/hooks';
import { readSection } from '@/application/markdown-source';
import { findTemplate, formatHookAlternatives, hookProblems, normaliseHook, scoreTotal, type HookAlternative } from '@/domain/hook-frameworks';
import { fingerprint } from '@/domain/hash';
import { findSection } from '@/domain/markdown';
import type { Platform } from '@/domain/enums';
import type { Actor } from '@/domain/mutation';
import { SYNTH_MASTER_FILE_ID } from '@/fixtures/synthetic';

const owner: Actor = { sub: '100000000000000000001', role: 'owner' };

let sheet: FakeSheetTransport;
let repo: SheetsContentRepository;
let drive: FakeDriveGateway;
let ai: FakeAiGateway;

beforeEach(() => {
  sheet = new FakeSheetTransport();
  repo = new SheetsContentRepository(sheet);
  drive = new FakeDriveGateway();
  ai = new FakeAiGateway();
});

async function load(libraryId: string) {
  const record = await repo.getLibrary(libraryId);
  const read = await readSection(drive, record);
  if (!read.ok) throw new Error(read.reason);
  return { record, section: read.section };
}

async function generate(libraryId: string, platform: Platform = 'LinkedIn'): Promise<{ proposal: HookProposal; record: Awaited<ReturnType<typeof load>>['record']; sectionHash: string }> {
  const { record, section } = await load(libraryId);
  const r = await generateHooks({ ai, libraryId, platform, currentHook: record.value.currentHook, draft: section.body, draftHash: fingerprint(section.body) });
  if (!r.ok) throw new Error(`generation failed: ${r.code}`);
  return { proposal: r.proposal, record, sectionHash: section.bodyHash };
}

function selection(g: Awaited<ReturnType<typeof generate>>, choice: SelectHookInput['choice'], n = '1'): SelectHookInput {
  return {
    operationId: `op_hook_${g.proposal.libraryId}_${n}`,
    libraryId: g.proposal.libraryId,
    expectedSheetRevision: g.record.revision,
    expectedSectionHash: g.sectionHash,
    generationDraftHash: g.proposal.draftHash,
    choice,
    alternatives: g.proposal.alternatives,
  };
}

const pick = (g: Awaited<ReturnType<typeof generate>>, index: number): SelectHookInput['choice'] => ({ kind: 'alternative', index, alternative: g.proposal.alternatives[index]! });

describe('HOOK-01: exactly three distinct, catalogued, correctly scored alternatives', () => {
  it('generates three alternatives with canonical frameworks and totals equal to the five scores', async () => {
    const { proposal } = await generate('SYN-L001');
    expect(proposal.alternatives).toHaveLength(3);
    for (const a of proposal.alternatives) {
      expect(findTemplate(a.template)?.framework).toBe(a.framework);
      expect(a.total).toBe(scoreTotal(a.scores));
    }
    const norm = proposal.alternatives.map((a) => normaliseHook(a.text));
    expect(new Set(norm).size).toBe(3);
    expect(norm).not.toContain(normaliseHook(proposal.currentHook));
  });

  it('validation rejects duplicates, near-copies of the current hook, bad totals and unknown templates', () => {
    const base: HookAlternative = {
      text: 'Scope sets the band.',
      framework: 'Contrarian',
      template: 'Contrarian #12',
      hookType: 'Contrarian',
      scores: { specificity: 2, tension: 1, audienceFit: 1, credibility: 1, valuePromise: 1 },
      total: 6,
    };
    const input = { platform: 'X' as const, currentHook: 'Most people negotiate the salary.' };
    const problems = hookProblems(
      {
        alternatives: [
          base,
          { ...base, text: 'SCOPE sets the band!' },
          { ...base, text: 'Most people negotiate the salary, sadly.', template: 'Mystery #1', total: 9 },
        ],
      },
      input,
    );
    expect(problems).toEqual(
      expect.arrayContaining([
        'alternatives.1.text: not materially different from alternatives.0',
        'alternatives.2.template: not in the catalogue',
        'alternatives.2.total: must equal the sum of the five scores',
        'alternatives.2.text: not materially different from the current hook',
      ]),
    );
    expect(hookProblems({ alternatives: [base] }, input)).toContain('alternatives: expected exactly 3, got 1');
  });

  it('a malformed first reply is repaired once; a second bad reply fails safely', async () => {
    ai.malformedNext(1);
    const ok = await generate('SYN-L001');
    expect(ok.proposal.meta.repaired).toBe(true);
    ai.malformedNext(2);
    const { record, section } = await load('SYN-L001');
    const r = await generateHooks({ ai, libraryId: 'SYN-L001', platform: 'X', currentHook: record.value.currentHook, draft: section.body, draftHash: fingerprint(section.body) });
    expect(r).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
  });
});

describe('HOOK-02: generation writes nothing', () => {
  it('leaves the Sheet and Drive untouched and records references by revision only', async () => {
    const before = drive.textOf(SYNTH_MASTER_FILE_ID);
    const { record, section } = await load('SYN-L001');
    const r = await generateHooks({
      ai,
      libraryId: 'SYN-L001',
      platform: 'X',
      currentHook: record.value.currentHook,
      draft: section.body,
      draftHash: fingerprint(section.body),
      references: [{ fileId: 'SYNTH_hook_reference', revision: '7', text: 'Synthetic swipe example: Everyone says X, but Y.' }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.proposal.references).toEqual([{ fileId: 'SYNTH_hook_reference', revision: '7' }]);
    expect(sheet.writes).toHaveLength(0);
    expect(drive.writes).toHaveLength(0);
    expect(drive.textOf(SYNTH_MASTER_FILE_ID)).toBe(before);
    expect((await repo.getLibrary('SYN-L001')).revision).toBe(record.revision);
    // References go to the model as untrusted, escaped data.
    const prompt = ai.requests.at(-1)!.messages[0]!.content;
    expect(prompt).toContain('<reference n="1">');
    expect(HOOK_TASK.system).toContain('never copy');
  });

  it('an alternative that copies a reference example is rejected', () => {
    const t = findTemplate('How-to #1')!;
    const copy: HookAlternative = { text: 'How to ask for the band in three steps', framework: t.framework, template: t.id, hookType: 'How-to', scores: { specificity: 1, tension: 1, audienceFit: 1, credibility: 1, valuePromise: 1 }, total: 5 };
    const problems = hookProblems({ alternatives: [copy] }, { platform: 'X', currentHook: 'Other.', references: [{ text: 'Example: how to ask for the band in three steps.' }] });
    expect(problems).toContain('alternatives.0.text: copies a reference example');
  });
});

describe('HOOK-03: selection updates hook and opening together', () => {
  it('replaces the opening line, saves Drive then Sheet, then writes all hook fields', async () => {
    const g = await generate('SYN-L001');
    const chosen = g.proposal.alternatives[1]!;
    const r = await selectHook(repo, drive, owner, selection(g, pick(g, 1)));
    expect(r.ok).toBe(true);
    expect(r.steps.map((s) => [s.provider, s.status])).toEqual([
      ['drive', 'done'],
      ['sheet', 'done'],
      ['sheet', 'done'],
    ]);
    const md = findSection(drive.textOf(SYNTH_MASTER_FILE_ID), 'SYN-L001');
    expect(md.ok && md.section.body).toBe(`${chosen.text}\n\nThe best candidates negotiate the scope first.\n\nScope decides the salary band.`);
    const row = (await repo.getLibrary('SYN-L001')).value;
    expect(row.currentHook).toBe(chosen.text);
    expect(row.draftContent).toBe(md.ok ? md.section.body : '');
    expect(row.hookTemplate).toBe(`${chosen.template} - ${findTemplate(chosen.template)!.pattern}`);
    expect(row.hookScore).toBe(chosen.total);
    expect(row.hookType).toBe(chosen.hookType);
    expect(row.hookAlternatives).toBe(formatHookAlternatives(g.proposal.alternatives));
    expect(row.hookAlternatives.split('\n')).toHaveLength(3);
  });

  it('keeping the current hook writes only Hook Alternatives', async () => {
    const g = await generate('SYN-L001');
    const r = await selectHook(repo, drive, owner, selection(g, { kind: 'current' }));
    expect(r.ok).toBe(true);
    expect(drive.writes).toHaveLength(0);
    const cells = sheet.writes.flatMap((w) => w.writes);
    expect(cells).toHaveLength(1);
    const row = (await repo.getLibrary('SYN-L001')).value;
    expect(row.currentHook).toBe('Most people negotiate the salary.');
    expect(row.hookAlternatives).toBe(formatHookAlternatives(g.proposal.alternatives));
  });

  it('a Sheet failure after the draft saved is PARTIAL_FAILURE, and a retry completes only the hook fields', async () => {
    const g = await generate('SYN-L001');
    const input = selection(g, pick(g, 0));
    // Draft saga: Sheet write 1 succeeds. Hook fields: Sheet write 2 fails.
    let writes = 0;
    sheet.beforeWrite = () => {
      writes += 1;
      if (writes === 2) sheet.failNext({ op: 'write', code: 'PROVIDER_UNAVAILABLE' });
    };
    const first = await selectHook(repo, drive, owner, input);
    expect(first).toMatchObject({ ok: false, code: 'PARTIAL_FAILURE' });
    expect(first.steps.map((s) => s.status)).toEqual(['done', 'done', 'failed']);
    sheet.beforeWrite = null;
    const partial = (await repo.getLibrary('SYN-L001')).value;
    expect(partial.draftContent.startsWith(g.proposal.alternatives[0]!.text)).toBe(true);
    expect(partial.currentHook).toBe('Most people negotiate the salary.');

    const retry = await selectHook(repo, drive, owner, input);
    expect(retry.ok).toBe(true);
    expect(retry.steps.map((s) => s.status)).toEqual(['skipped_already_applied', 'done']);
    expect((await repo.getLibrary('SYN-L001')).value.currentHook).toBe(g.proposal.alternatives[0]!.text);
    expect(drive.writes).toHaveLength(1);

    const replay = await selectHook(repo, drive, owner, input);
    expect(replay).toMatchObject({ ok: true, replayed: true });
  });

  it('a Drive failure writes nothing to the Sheet', async () => {
    const g = await generate('SYN-L001');
    drive.failNext({ op: 'write', code: 'PROVIDER_UNAVAILABLE' });
    const r = await selectHook(repo, drive, owner, selection(g, pick(g, 2)));
    expect(r).toMatchObject({ ok: false, code: 'PROVIDER_UNAVAILABLE' });
    expect(sheet.writes).toHaveLength(0);
  });

  it('refuses when the draft does not open with the current hook', async () => {
    const g = await generate('SYN-L005');
    // Make the Sheet hook differ from the Markdown opening without touching the draft.
    const row = await repo.getLibrary('SYN-L005');
    await repo.updateLibrary({ operationId: 'op_setup_hook_1', actor: owner, target: { libraryId: 'SYN-L005' }, expectedRevision: row.revision, patch: { currentHook: 'A different opening.' } });
    const fresh = await repo.getLibrary('SYN-L005');
    const r = await selectHook(repo, drive, owner, { ...selection(g, pick(g, 0)), expectedSheetRevision: fresh.revision });
    expect(r).toMatchObject({ ok: false, code: 'CONFLICT', details: { reason: 'opening_mismatch' } });
    expect(drive.writes).toHaveLength(0);
  });

  it('refuses a choice that is not one of the three alternatives', async () => {
    const g = await generate('SYN-L001');
    const forged = { ...g.proposal.alternatives[0]!, text: 'Something never generated.' };
    const r = await selectHook(repo, drive, owner, selection(g, { kind: 'alternative', index: 0, alternative: forged }));
    expect(r).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
  });
});

describe('HOOK-04: LinkedIn checks and no 280 cap for X', () => {
  it('every LinkedIn alternative carries all LinkedInify checks', async () => {
    const { proposal } = await generate('SYN-L001', 'LinkedIn');
    for (const a of proposal.alternatives) {
      expect(a.linkedinChecks).toMatchObject({ audience: expect.any(Boolean), roleOrKeyword: expect.any(Boolean), directRelevance: expect.any(Boolean), notes: expect.any(String) });
    }
    const stripped = { alternatives: proposal.alternatives.map(({ linkedinChecks: _c, ...a }) => a) };
    expect(hookProblems(stripped, { platform: 'LinkedIn', currentHook: proposal.currentHook })).toContain('alternatives.0.linkedinChecks: required for LinkedIn');
  });

  it('a long X hook (over 280 characters) is valid', () => {
    const long = `Long X hook ${'with real detail '.repeat(20)}`.trim();
    expect(long.length).toBeGreaterThan(280);
    const t = (id: string) => findTemplate(id)!;
    const mk = (id: string, text: string): HookAlternative => ({ text, framework: t(id).framework, template: id, hookType: t(id).framework, scores: { specificity: 1, tension: 1, audienceFit: 1, credibility: 1, valuePromise: 1 }, total: 5 });
    expect(hookProblems({ alternatives: [mk('Story #7', long), mk('List #4', 'Four checks first.'), mk('Warning #9', 'Do not sign yet.')] }, { platform: 'X', currentHook: 'Short.' })).toEqual([]);
  });
});

describe('HOOK-05: stale generation or selection cannot overwrite newer work', () => {
  it('refuses when the draft changed after generation', async () => {
    const g = await generate('SYN-L001');
    const text = drive.textOf(SYNTH_MASTER_FILE_ID);
    drive.externalEdit(SYNTH_MASTER_FILE_ID, text.replace('Scope decides the salary band.', 'Scope decides the band. Edited.'));
    const r = await selectHook(repo, drive, owner, selection(g, pick(g, 0)));
    expect(r).toMatchObject({ ok: false, code: 'STALE_READ' });
    expect(sheet.writes).toHaveLength(0);
    expect(drive.writes).toHaveLength(0);
  });

  it('refuses when the row moved (for example a hook chosen elsewhere)', async () => {
    const g = await generate('SYN-L001');
    const row = await repo.getLibrary('SYN-L001');
    await repo.updateLibrary({ operationId: 'op_setup_hook_2', actor: owner, target: { libraryId: 'SYN-L001' }, expectedRevision: row.revision, patch: { hookType: 'Story' } });
    const r = await selectHook(repo, drive, owner, selection(g, pick(g, 0)));
    expect(r).toMatchObject({ ok: false, code: 'STALE_READ' });
    expect(drive.writes).toHaveLength(0);
  });

  it('a viewer cannot select', async () => {
    const g = await generate('SYN-L001');
    expect(await selectHook(repo, drive, { ...owner, role: 'viewer' }, selection(g, pick(g, 0)))).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });
});
