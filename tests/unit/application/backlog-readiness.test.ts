import { describe, expect, it } from 'vitest';
import { backlogReadiness } from '@/application/backlog-readiness';
import { FakeSheetTransport } from '@/integrations/google/fake-sheet';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';
import { lineageLink } from '@/application/ready';

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

  it('only labels a matching and release-ready scheduled copy ready for Typefully', async () => {
    const { library, queue, schedule } = await fixture();
    const readyId = [...backlogReadiness(library, queue, schedule)].find(([id, status]) => {
      const platform = library.find((r) => r.value.libraryId === id)?.value.targetPlatform;
      return status.label === 'Ready to schedule' && platform?.ok && platform.value === 'LinkedIn';
    })?.[0];
    expect(readyId).toBeDefined();
    const item = library.find((row) => row.value.libraryId === readyId)!.value;
    const original = schedule[0]!;
    const slot = { ...original, value: { ...original.value, sourceLink: lineageLink('https://drive.google.com/file/d/SYNTH_source/view', readyId!),
      platform: item.targetPlatform, hook: item.currentHook, content: item.draftContent,
      contentStage: { ok: true as const, value: 'Ready' as const }, typefullyStatus: { ok: true as const, value: 'Not Sent' as const } } };
    const status = backlogReadiness(library, queue, [...schedule, slot]).get(readyId!);
    expect(status?.label).toBe('Ready for Typefully');
    const changed = { ...slot, value: { ...slot.value, content: `${slot.value.content} changed` } };
    expect(backlogReadiness(library, queue, [...schedule, changed]).get(readyId!)?.label).toBe('Needs reconciliation');
  });
});
