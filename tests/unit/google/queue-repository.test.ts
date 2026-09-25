import { beforeEach, describe, expect, it } from 'vitest';
import { FakeSheetTransport } from '@/integrations/google/fake-sheet';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';
import type { Actor } from '@/domain/mutation';

/**
 * Content Queue tab (idea-stage backlog rows, IDEA-BL-NNNN): same header row and
 * column layout as Content Library, read/written through the exact same generic
 * machinery, just pointed at a second tab.
 */

const owner: Actor = { sub: '100000000000000000001', role: 'owner' };
let transport: FakeSheetTransport;
let repo: SheetsContentRepository;

beforeEach(() => {
  transport = new FakeSheetTransport();
  repo = new SheetsContentRepository(transport);
});

const op = (n: string) => `op_${n}_000000`;

describe('Content Queue: listQueue', () => {
  it('returns the seeded synthetic Queue rows', async () => {
    const rows = await repo.listQueue();
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => r.value.libraryId).sort()).toEqual([
      'IDEA-BL-0001',
      'IDEA-BL-0002',
      'IDEA-BL-0003',
      'IDEA-BL-0004',
      'IDEA-BL-0005',
    ]);
  });

  it('idea rows carry State = Idea', async () => {
    const rows = await repo.listQueue();
    for (const r of rows) expect(r.value.state).toBe('Idea');
  });
});

describe('Content Queue: getQueue', () => {
  it('returns a single matching record', async () => {
    const r = await repo.getQueue('IDEA-BL-0003');
    expect(r.value.libraryId).toBe('IDEA-BL-0003');
    expect(r.value.contentSource).toBe('Synthetic Backlog Ideas');
  });
});

describe('Content Queue: updateQueue', () => {
  it('writes only the named cells', async () => {
    const item = await repo.getQueue('IDEA-BL-0001');
    const r = await repo.updateQueue({
      operationId: op('queue-named'),
      actor: owner,
      target: { libraryId: 'IDEA-BL-0001' },
      expectedRevision: item.revision,
      patch: { draftContent: 'Updated idea draft.' },
    });
    expect(r.ok).toBe(true);
    expect(transport.writes[0]!.writes).toHaveLength(1);
    expect(transport.writes[0]!.writes[0]!.row).toBe(item.row);
    if (r.ok) {
      expect(r.value.value.draftContent).toBe('Updated idea draft.');
      expect(r.value.revision).not.toBe(item.revision);
    }
  });

  it('never writes Content Library when updating Content Queue', async () => {
    const item = await repo.getQueue('IDEA-BL-0002');
    await repo.updateQueue({
      operationId: op('queue-isolated'),
      actor: owner,
      target: { libraryId: 'IDEA-BL-0002' },
      expectedRevision: item.revision,
      patch: { draftContent: 'Another idea update.' },
    });
    expect(transport.writes.every((w) => w.tab === 'Content Queue')).toBe(true);
    // Content Library's own IDEA-BL-* ids (there are none) or SYN-L* rows are untouched.
    const lib = await repo.listLibrary();
    expect(lib.map((r) => r.value.libraryId)).not.toContain('IDEA-BL-0002');
  });
});

describe('Content Queue: createQueueIdea', () => {
  const input = {
    operationId: op('reply-idea'),
    actor: owner,
    libraryId: 'IDEA-SR-1234567890abcdef',
    sourcePlatform: 'LinkedIn' as const,
    currentHook: 'The strongest reply insight.',
    draftContent: 'The strongest reply insight.\n\nTurn it into a full post.',
  };

  it('appends one row using only the existing Queue columns', async () => {
    const before = await repo.listQueue();
    const result = await repo.createQueueIdea(input);
    expect(result).toMatchObject({ ok: true, replayed: false });
    const after = await repo.listQueue();
    expect(after).toHaveLength(before.length + 1);
    const created = await repo.getQueue(input.libraryId);
    expect(created.value).toMatchObject({
      libraryId: input.libraryId,
      state: 'Idea',
      contentSource: 'Social Replies',
      currentHook: input.currentHook,
      draftContent: input.draftContent,
    });
    expect(created.value.sourcePlatform).toMatchObject({ ok: true, value: 'LinkedIn' });
    expect(transport.writes.at(-1)?.tab).toBe('Content Queue');
  });

  it('replays the same Reply ID without appending a duplicate', async () => {
    expect((await repo.createQueueIdea(input)).ok).toBe(true);
    const replay = await repo.createQueueIdea(input);
    expect(replay).toMatchObject({ ok: true, replayed: true });
    expect((await repo.listQueue()).filter((row) => row.value.libraryId === input.libraryId)).toHaveLength(1);
  });

  it('refuses a viewer before touching the Sheet', async () => {
    const result = await repo.createQueueIdea({ ...input, actor: { ...owner, role: 'viewer' } });
    expect(result).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(transport.writes).toHaveLength(0);
  });
});

describe('schema discovery includes Content Queue', () => {
  it('reports the Queue tab healthy', async () => {
    const s = await repo.schema();
    expect(s.ok).toBe(true);
    const queueTab = s.tabs.find((t) => t.tab === 'Content Queue');
    expect(queueTab).toMatchObject({ ok: true });
  });
});
