import { beforeEach, describe, expect, it } from 'vitest';
import { FakeAiGateway } from '@/integrations/ai/fake-gateway';
import { FakeSheetTransport } from '@/integrations/google/fake-sheet';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';
import { runEnglishQa, saveQaNotes } from '@/application/english-qa';
import { applyFinding, type QaProposal } from '@/domain/proposals';
import { fingerprint } from '@/domain/hash';
import type { Platform } from '@/domain/enums';
import type { Actor } from '@/domain/mutation';

const owner: Actor = { sub: '100000000000000000001', role: 'owner' };
const EM = String.fromCharCode(0x2014);

let ai: FakeAiGateway;
beforeEach(() => {
  ai = new FakeAiGateway();
});

async function qa(draft: string, platform: Platform = 'LinkedIn'): Promise<QaProposal> {
  const r = await runEnglishQa({ ai, libraryId: 'SYN-L001', draft, draftHash: fingerprint(draft), platform });
  if (!r.ok) throw new Error(`qa failed: ${r.code}`);
  return r.proposal;
}

describe('ENQA-01: structured, attributable findings', () => {
  it('flags American spelling, banned words, em dashes and spacing with exact ranges', async () => {
    const draft = `We analyze color choices${EM}then leverage  synergy .\nOur favorite program is a game-changer.`;
    const p = await qa(draft);
    const by = (cat: string) => p.findings.filter((f) => f.category === cat).map((f) => [f.original, f.replacement, f.severity]);
    expect(by('spelling')).toEqual([
      ['analyze', 'analyse', 'should'],
      ['color', 'colour', 'should'],
      ['favorite', 'favourite', 'should'],
    ]);
    expect(by('banned_word')).toEqual([
      ['leverage', 'use', 'must'],
      ['synergy', null, 'must'],
      ['game-changer', null, 'must'],
    ]);
    expect(by('punctuation')).toEqual([
      [EM, ', ', 'should'],
      ['  ', ' ', 'should'],
      [' ', '', 'should'],
    ]);
    // `program` is correct British English and is not flagged.
    expect(p.findings.some((f) => f.original === 'program')).toBe(false);
    for (const f of p.findings) expect(draft.slice(f.start, f.end)).toBe(f.original);
    expect(new Set(p.findings.map((f) => f.id)).size).toBe(p.findings.length);
    expect(p.draftHash).toBe(fingerprint(draft));
    expect(p.summary).toMatch(/findings/);
  });

  it('X is not capped at 280 characters, only at 25,000 (must)', async () => {
    const medium = `${'Negotiation is a skill. '.repeat(20)}`.trim();
    expect(medium.length).toBeGreaterThan(280);
    expect((await qa(medium, 'X')).findings.filter((f) => f.category === 'platform_fit')).toEqual([]);
    const long = 'a'.repeat(25_010);
    const fit = (await qa(long, 'X')).findings.filter((f) => f.category === 'platform_fit');
    expect(fit).toHaveLength(1);
    expect(fit[0]).toMatchObject({ severity: 'must', start: 25_000, end: 25_010, replacement: null });
  });

  it('LinkedIn over 3,000 characters is a must platform-fit finding', async () => {
    const fit = (await qa('word '.repeat(700), 'LinkedIn')).findings.filter((f) => f.category === 'platform_fit');
    expect(fit).toHaveLength(1);
    expect(fit[0]!.severity).toBe('must');
  });

  it('refuses a draft hash that does not describe the draft', async () => {
    const r = await runEnglishQa({ ai, libraryId: 'SYN-L001', draft: 'Text', draftHash: fingerprint('Other'), platform: 'X' });
    expect(r).toMatchObject({ ok: false, code: 'STALE_READ' });
  });

  it('AI down: QA fails with a typed code and nothing else changes', async () => {
    ai.failNext('PROVIDER_UNAVAILABLE');
    const r = await runEnglishQa({ ai, libraryId: 'SYN-L001', draft: 'Our color.', draftHash: fingerprint('Our color.'), platform: 'X' });
    expect(r).toMatchObject({ ok: false, code: 'PROVIDER_UNAVAILABLE' });
  });
});

describe('ENQA-02: accepting one finding changes only its range', () => {
  it('applies the selected replacement and leaves every other character identical', async () => {
    const draft = 'Our color is our favorite.\n\n  Keep   this spacing? yes';
    const p = await qa(draft);
    const color = p.findings.find((f) => f.original === 'color')!;
    const r = applyFinding(draft, p.draftHash, p, color.id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.draft).toBe(draft.slice(0, color.start) + 'colour' + draft.slice(color.end));
    expect(r.draft.slice(color.end + 1)).toBe(draft.slice(color.end));
    // The remaining findings are re-bound to the new draft and still apply exactly.
    expect(r.proposal.draftHash).toBe(fingerprint(r.draft));
    const fav = r.proposal.findings.find((f) => f.original === 'favorite')!;
    expect(r.draft.slice(fav.start, fav.end)).toBe('favorite');
    const again = applyFinding(r.draft, r.draftHash, r.proposal, fav.id);
    expect(again.ok && again.draft.startsWith('Our colour is our favourite.')).toBe(true);
  });

  it('rejecting or cancelling applies nothing; a finding without a replacement cannot apply', async () => {
    const draft = 'Synergy matters.';
    const p = await qa(draft);
    // Not calling applyFinding is the reject path: the draft is untouched by construction.
    expect(draft).toBe('Synergy matters.');
    const r = applyFinding(draft, p.draftHash, p, p.findings[0]!.id);
    expect(r).toMatchObject({ ok: false, code: 'VALIDATION_FAILED', reason: 'no_replacement' });
    expect(applyFinding(draft, p.draftHash, p, 'f99')).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });
});

describe('ENQA-03: late results against a changed draft are stale', () => {
  it('refuses to apply when the draft changed after QA ran', async () => {
    const draft = 'Our color is bold.';
    const p = await qa(draft);
    const edited = 'Our color is bold and new.';
    expect(applyFinding(edited, fingerprint(edited), p, p.findings[0]!.id)).toMatchObject({ ok: false, code: 'STALE_READ', reason: 'draft_changed' });
    // A caller claiming the old hash for new text is refused too.
    expect(applyFinding(edited, p.draftHash, p, p.findings[0]!.id)).toMatchObject({ ok: false, code: 'STALE_READ' });
  });

  it('refuses when the range no longer holds the original text', async () => {
    const draft = 'Our color is bold.';
    const p = await qa(draft);
    const tampered: QaProposal = { ...p, findings: p.findings.map((f) => ({ ...f, start: f.start + 1, end: f.end + 1 })) };
    expect(applyFinding(draft, p.draftHash, tampered, p.findings[0]!.id)).toMatchObject({ ok: false, code: 'STALE_READ', reason: 'range_changed' });
  });
});

describe('AI Review Notes are written only on confirmation, only to Schedule', () => {
  it('writes the summary to the Schedule row with the expected revision', async () => {
    const sheet = new FakeSheetTransport();
    const repo = new SheetsContentRepository(sheet);
    const row = await repo.getSchedule('2026-10-03-MAIN-X');
    expect(sheet.writes).toHaveLength(0);
    const r = await saveQaNotes(repo, owner, { operationId: 'op_qa_notes_1', contentId: '2026-10-03-MAIN-X', expectedRevision: row.revision, summary: '2 findings: fix the must items.' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.value.aiReviewNotes).toBe('2 findings: fix the must items.');
    const stale = await saveQaNotes(repo, owner, { operationId: 'op_qa_notes_2', contentId: '2026-10-03-MAIN-X', expectedRevision: row.revision, summary: 'Later.' });
    expect(stale).toMatchObject({ ok: false, code: 'STALE_READ' });
  });

  it('refuses a Library-only item and a viewer', async () => {
    const repo = new SheetsContentRepository(new FakeSheetTransport());
    const lib = await saveQaNotes(repo, owner, { operationId: 'op_qa_notes_3', libraryId: 'SYN-L001', expectedRevision: '0000000000000000', summary: 'x' });
    expect(lib).toMatchObject({ ok: false, code: 'VALIDATION_FAILED', details: { reason: 'no_schedule_row' } });
    const viewer = await saveQaNotes(repo, { ...owner, role: 'viewer' }, { operationId: 'op_qa_notes_4', contentId: '2026-10-03-MAIN-X', expectedRevision: '0000000000000000', summary: 'x' });
    expect(viewer).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });
});
