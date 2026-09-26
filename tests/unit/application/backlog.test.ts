import { beforeEach, describe, expect, it } from 'vitest';
import { FakeSheetTransport } from '@/integrations/google/fake-sheet';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';
import {
  applyBacklogEdit,
  backlogEditSchema,
  loadBacklogGroups,
  loadBacklogOptions,
  replyContentIdeaSchema,
  saveReplyAsContentIdea,
} from '@/application/backlog';
import { SHEET_TABS } from '@/domain/sheet-schema';
import type { Actor } from '@/domain/mutation';

/**
 * Backlog (Content Queue) read model and edits: groups idea-stage rows by
 * source the way the Queue Summary tab does, and edits a single row through
 * the same mutation envelope as Review transitions.
 */

const owner: Actor = { sub: '100000000000000000001', role: 'owner' };
const viewer: Actor = { sub: '100000000000000000002', role: 'viewer' };
let transport: FakeSheetTransport;
let repo: SheetsContentRepository;

beforeEach(() => {
  transport = new FakeSheetTransport();
  repo = new SheetsContentRepository(transport);
});

const op = (n: string) => `op_backlog_${n}_00000`;

describe('loadBacklogGroups', () => {
  it('groups the 5 synthetic rows into 2 sources, sorted by source name, items sorted by libraryId', async () => {
    const groups = await loadBacklogGroups(repo);
    expect(groups.map((g) => g.source)).toEqual(['Synthetic Backlog Ideas', 'Synthetic Interview Prep']);
    expect(groups.map((g) => g.total)).toEqual([3, 2]);
    expect(groups[0]!.items.map((i) => i.libraryId)).toEqual(['IDEA-BL-0001', 'IDEA-BL-0002', 'IDEA-BL-0003']);
    expect(groups[1]!.items.map((i) => i.libraryId)).toEqual(['IDEA-BL-0004', 'IDEA-BL-0005']);
  });

  it('maps hook/slug/thumb the same way review.toCard does', async () => {
    const groups = await loadBacklogGroups(repo);
    const first = groups[0]!.items[0]!;
    const record = await repo.getQueue(first.libraryId);
    expect(first.hook).toBe(record.value.currentHook);
    expect(first.slug).toBe(record.value.slug);
    expect(first.revision).toBe(record.revision);
    expect(first.row).toBe(record.row);
    expect(first.thumb).toEqual({ src: null, label: 'No image decided', tone: 'todo' });
  });

  it('drops an empty-source row into a group literally named "Uncategorised" at the end', async () => {
    const header = transport.rawTab(SHEET_TABS.queue.name)[0]!.map((c) => c.value);
    const contentSourceCol = header.indexOf('Content Source');
    const record = await repo.getQueue('IDEA-BL-0001');
    transport.externalEdit(SHEET_TABS.queue.name, record.row, contentSourceCol, '');

    const groups = await loadBacklogGroups(repo);
    expect(groups.map((g) => g.source)).toEqual(['Synthetic Backlog Ideas', 'Synthetic Interview Prep', 'Uncategorised']);
    expect(groups.at(-1)).toMatchObject({ source: 'Uncategorised', total: 1 });
    expect(groups.at(-1)!.items.map((i) => i.libraryId)).toEqual(['IDEA-BL-0001']);
  });
});

describe('applyBacklogEdit', () => {
  it('patches currentHook and returns the new revision', async () => {
    const before = await repo.getQueue('IDEA-BL-0001');
    const outcome = await applyBacklogEdit(repo, owner, {
      operationId: op('hook'),
      libraryId: 'IDEA-BL-0001',
      expectedRevision: before.revision,
      patch: { currentHook: 'A brand new hook.' },
    });
    expect(outcome).toMatchObject({ ok: true, replayed: false });
    if (outcome.ok) {
      expect(outcome.item.hook).toBe('A brand new hook.');
      expect(outcome.revision).not.toBe(before.revision);
    }
    const after = await repo.getQueue('IDEA-BL-0001');
    expect(after.value.currentHook).toBe('A brand new hook.');
  });

  it('a stale expectedRevision returns STALE_READ and writes nothing', async () => {
    const before = await repo.getQueue('IDEA-BL-0002');
    const outcome = await applyBacklogEdit(repo, owner, {
      operationId: op('stale'),
      libraryId: 'IDEA-BL-0002',
      expectedRevision: `${before.revision.slice(0, -1)}${before.revision.endsWith('0') ? '1' : '0'}`,
      patch: { currentHook: 'Should not land.' },
    });
    expect(outcome).toMatchObject({ ok: false, code: 'STALE_READ' });
    expect(transport.writes).toHaveLength(0);
    const after = await repo.getQueue('IDEA-BL-0002');
    expect(after.value.currentHook).toBe(before.value.currentHook);
  });

  it('a viewer actor gets FORBIDDEN and writes nothing', async () => {
    const before = await repo.getQueue('IDEA-BL-0003');
    const outcome = await applyBacklogEdit(repo, viewer, {
      operationId: op('forbidden'),
      libraryId: 'IDEA-BL-0003',
      expectedRevision: before.revision,
      patch: { currentHook: 'Should not land either.' },
    });
    expect(outcome).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(transport.writes).toHaveLength(0);
  });

  it('patches platform, pesto and hookTemplate together, all reflected in the returned item and the sheet', async () => {
    // The synthetic fixture defaults targetPlatform to LinkedIn and hookTemplate to the
    // "Contrarian #12" catalogue entry (LIBRARY_DEFAULTS): pick different values so this
    // test actually exercises the write path rather than re-writing the existing defaults.
    const before = await repo.getQueue('IDEA-BL-0004');
    const outcome = await applyBacklogEdit(repo, owner, {
      operationId: op('fields'),
      libraryId: 'IDEA-BL-0004',
      expectedRevision: before.revision,
      patch: { platform: 'X', pesto: 'Opinions', hookTemplate: 'Story #7 - The day X changed how I Y' },
    });
    expect(outcome).toMatchObject({ ok: true, replayed: false });
    if (outcome.ok) {
      expect(outcome.item.platform).toBe('X');
      expect(outcome.item.pesto).toBe('Opinions');
      expect(outcome.item.hookTemplate).toBe('Story #7 - The day X changed how I Y');
    }
    const after = await repo.getQueue('IDEA-BL-0004');
    expect(after.value.targetPlatform).toMatchObject({ ok: true, value: 'X' });
    expect(after.value.pesto).toBe('Opinions');
    expect(after.value.hookTemplate).toBe('Story #7 - The day X changed how I Y');
  });

  it('an empty-string platform clears the cell', async () => {
    const set = await applyBacklogEdit(repo, owner, {
      operationId: op('platform-set'),
      libraryId: 'IDEA-BL-0005',
      expectedRevision: (await repo.getQueue('IDEA-BL-0005')).revision,
      patch: { platform: 'X' },
    });
    expect(set.ok).toBe(true);
    if (!set.ok) return;
    const cleared = await applyBacklogEdit(repo, owner, {
      operationId: op('platform-clear'),
      libraryId: 'IDEA-BL-0005',
      expectedRevision: set.revision,
      patch: { platform: '' },
    });
    expect(cleared).toMatchObject({ ok: true });
    if (cleared.ok) expect(cleared.item.platform).toBeNull();
  });

  it('an unrecognised platform value is rejected by the schema before it reaches the repository', () => {
    const parsed = backlogEditSchema.safeParse({
      operationId: op('bad-platform'),
      libraryId: 'IDEA-BL-0001',
      expectedRevision: '"row-1-abc"',
      patch: { platform: 'Bluesky' },
    });
    expect(parsed.success).toBe(false);
  });
});

describe('loadBacklogOptions', () => {
  it('collects distinct, sorted PESTO stages and hook templates already present in the sheet', async () => {
    await applyBacklogEdit(repo, owner, {
      operationId: op('opts-1'),
      libraryId: 'IDEA-BL-0001',
      expectedRevision: (await repo.getQueue('IDEA-BL-0001')).revision,
      patch: { pesto: 'Story', hookTemplate: 'Story #7 - The day X changed how I Y' },
    });
    await applyBacklogEdit(repo, owner, {
      operationId: op('opts-2'),
      libraryId: 'IDEA-BL-0002',
      expectedRevision: (await repo.getQueue('IDEA-BL-0002')).revision,
      patch: { pesto: 'Opinions' },
    });
    const options = await loadBacklogOptions(repo);
    expect(options.pestoStages).toEqual(['Opinions', 'Story']);
    // Every other synthetic row still carries the fixture's default hookTemplate
    // ("Contrarian #12" — LIBRARY_DEFAULTS), so both it and the overridden row's value are present.
    expect(options.hookTemplates).toEqual(['Contrarian #12 - Everyone says X, but Y', 'Story #7 - The day X changed how I Y']);
  });
});

describe('saveReplyAsContentIdea', () => {
  it('rejects browser-supplied platform or text in the request contract', () => {
    expect(replyContentIdeaSchema.safeParse({
      operationId: op('forged'), replyId: '12345678-1234-4123-8123-1234567890ab',
      platform: 'x', finalText: 'Forged copy',
    }).success).toBe(false);
  });

  it('refuses a viewer before writing to the Sheet', async () => {
    const result = await saveReplyAsContentIdea(repo, viewer, {
      operationId: op('viewer-reply'), replyId: '12345678-1234-4123-8123-1234567890ab',
    }, { platform: 'x', finalText: 'A post' });
    expect(result).toEqual({ ok: false, code: 'FORBIDDEN' });
    await expect(repo.getQueue('IDEA-SR-1234567812344123')).rejects.toThrow();
  });

  it('derives a stable Queue ID and uses the first paragraph as the hook', async () => {
    const outcome = await saveReplyAsContentIdea(repo, owner, {
      operationId: op('reply-content'),
      replyId: '12345678-1234-4123-8123-1234567890ab',
    }, { platform: 'threads', finalText: 'First insight.\n\nA second paragraph stays in the draft.' });
    expect(outcome).toMatchObject({
      ok: true,
      item: {
        libraryId: 'IDEA-SR-1234567812344123',
        hook: 'First insight.',
        platform: 'Threads',
      },
    });
    const row = await repo.getQueue('IDEA-SR-1234567812344123');
    expect(row.value.draftContent).toBe('First insight.\n\nA second paragraph stays in the draft.');
    const retry = await saveReplyAsContentIdea(repo, owner, {
      operationId: op('reply-content'), replyId: '12345678-1234-4123-8123-1234567890ab',
    }, { platform: 'threads', finalText: 'First insight.\n\nA second paragraph stays in the draft.' });
    expect(retry).toMatchObject({ ok: true, replayed: true, item: { libraryId: 'IDEA-SR-1234567812344123' } });
  });

  it('preserves exact CJK text and whitespace from the recorded reply', async () => {
    const text = '  首句。\n\n第二段保留。  ';
    const outcome = await saveReplyAsContentIdea(repo, owner, {
      operationId: op('reply-cjk'), replyId: '12345678-1234-4123-8123-1234567890ab',
    }, { platform: 'threads', finalText: text });
    expect(outcome).toMatchObject({ ok: true, item: { hook: '首句。' } });
    const row = await repo.getQueue('IDEA-SR-1234567812344123');
    expect(row.value.draftContent).toBe(text);
  });
});
