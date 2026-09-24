import { beforeEach, describe, expect, it } from 'vitest';
import { FakeSheetTransport } from '@/integrations/google/fake-sheet';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';
import { applyBacklogEdit, loadBacklogGroups } from '@/application/backlog';
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
});
