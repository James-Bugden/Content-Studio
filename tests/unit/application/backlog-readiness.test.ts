import { describe, expect, it } from 'vitest';
import { backlogReadiness } from '@/application/backlog-readiness';
import { FakeSheetTransport } from '@/integrations/google/fake-sheet';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';

async function fixture() {
  const repo = new SheetsContentRepository(new FakeSheetTransport());
  return { library: await repo.listLibrary(), queue: await repo.listReadyQueue(), schedule: await repo.listSchedule() };
}

describe('Backlog readiness', () => {
  it('fails closed when a provider is unavailable and never equates approval to sending', async () => {
    const { library, queue, schedule } = await fixture();
    const approved = library.find((r) => r.value.reviewStatus.ok && r.value.reviewStatus.value === 'Approved' && r.value.queueForSchedule);
    expect(approved).toBeDefined();
    expect(backlogReadiness(library, null, schedule).get(approved!.value.libraryId)?.label).toBe('Readiness unknown');
    expect(backlogReadiness(library, queue, null).get(approved!.value.libraryId)?.label).toBe('Readiness unknown');
    expect(backlogReadiness(library, queue, schedule).get(approved!.value.libraryId)?.label).not.toBe('Ready for Typefully');
  });

  it('marks derived queue drift for reconciliation', async () => {
    const { library, queue, schedule } = await fixture();
    const candidate = queue.find((r) => library.some((l) => l.value.libraryId === r.value.libraryId));
    expect(candidate).toBeDefined();
    const drifted = { ...candidate!, cells: { ...candidate!.cells, draftContent: 'synthetic drift' } };
    expect(backlogReadiness(library, [drifted], schedule).get(candidate!.value.libraryId)).toMatchObject({ label: 'Needs reconciliation', tone: 'blocked' });
  });
});
