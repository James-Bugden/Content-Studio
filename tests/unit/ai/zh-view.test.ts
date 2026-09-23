import { beforeEach, describe, expect, it } from 'vitest';
import { FakeSheetTransport } from '@/integrations/google/fake-sheet';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';
import { loadAdaptationView } from '@/application/zh-view';
import { isAppError } from '@/domain/errors';

/** CS-011 adaptation page read model: eligibility in words, lineage and freshness. */
let repo: SheetsContentRepository;

beforeEach(() => {
  repo = new SheetsContentRepository(new FakeSheetTransport());
});

describe('loadAdaptationView', () => {
  it('an eligible EN Approved X row with no adaptation is missing, with its Threads row resolved', async () => {
    const view = await loadAdaptationView(repo, '2026-10-03-MAIN-X');
    expect(view.blockers).toEqual([]);
    expect(view.state).toBe('missing');
    expect(view.threads).toMatchObject({ kind: 'found', contentId: '2026-10-03-MAIN-TH' });
    expect(view.source.hook).toBe('Recruiters read the first line.');
  });

  it('an X edit after translation is stale', async () => {
    expect((await loadAdaptationView(repo, '2026-10-02-MAIN-X')).state).toBe('stale');
  });

  it('an empty slot lists every blocker in words', async () => {
    const view = await loadAdaptationView(repo, '2026-10-01-2ND-X');
    const codes = view.blockers.map((b) => b.code);
    expect(codes).toEqual(expect.arrayContaining(['missing_hook', 'missing_content']));
    expect(codes.some((c) => c === 'stage_missing' || c === 'stage_unrecognised')).toBe(true);
    for (const b of view.blockers) expect(b.message).not.toContain('—');
  });

  it('a Threads row is not an X source', async () => {
    const view = await loadAdaptationView(repo, '2026-10-03-MAIN-TH');
    expect(view.blockers.map((b) => b.code)).toContain('not_x');
  });

  it('an unknown Content ID is NOT_FOUND', async () => {
    const err = await loadAdaptationView(repo, '2030-01-01-MAIN-X').catch((e: unknown) => e);
    expect(isAppError(err) && err.code).toBe('NOT_FOUND');
  });
});
