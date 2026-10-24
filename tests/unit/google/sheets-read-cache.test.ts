import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeSheetTransport } from '@/integrations/google/fake-sheet';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';
import { SHEET_TABS } from '@/domain/sheet-schema';
import { setTelemetrySink, type TelemetryEvent } from '@/observability/events';
import { summariseEvents } from '@/observability/alerts';

afterEach(() => { vi.restoreAllMocks(); setTelemetrySink(null); });

function setup(ttl = 15_000) {
  const transport = new FakeSheetTransport();
  const repo = new SheetsContentRepository(transport, { writable: true, readCacheMs: ttl });
  return { transport, repo };
}

function pauseNextRead(transport: FakeSheetTransport, fail = false) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const read = transport.readTab.bind(transport);
  vi.spyOn(transport, 'readTab').mockImplementationOnce(async (...args) => {
    const snapshot = await read(...args);
    await gate;
    if (fail) throw new Error('synthetic read failure');
    return snapshot;
  });
  return release;
}

describe('CS-045: shared Sheets reads', () => {
  it('N concurrent Backlog Library reads share one provider call even without retention', async () => {
    const { transport, repo } = setup(0);
    const results = await Promise.all(Array.from({ length: 8 }, () => repo.listLibrary()));
    expect(results.every((rows) => rows.length === results[0]!.length)).toBe(true);
    expect(transport.reads).toBe(1);
    await repo.listLibrary();
    expect(transport.reads).toBe(2); // no retained snapshot at TTL zero
  });

  it('concurrent cold Backlog page loads share each of the three tabs', async () => {
    const { transport, repo } = setup(0);
    const events: TelemetryEvent[] = [];
    setTelemetrySink((event) => events.push(event));
    const page = () => Promise.all([repo.listLibrary(), repo.listReadyQueue(), repo.listSchedule()]);
    await Promise.all([page(), page()]);
    expect(transport.reads).toBe(3);
    expect(events.filter((event) => event.name === 'sheet.read').map((event) => event.facts?.tab).sort())
      .toEqual(['library', 'readyQueue', 'schedule']);
  });

  it.each(['listLibrary', 'listQueue', 'listReadyQueue', 'listSchedule', 'queueSummary', 'workflowSettings'] as const)(
    '%s shares an in-flight read and retains the result within the configured TTL', async (method) => {
      const { transport, repo } = setup();
      await Promise.all([repo[method](), repo[method]()]);
      await repo[method]();
      expect(transport.reads).toBe(1);
    },
  );

  it('a pending read is shared even after the retention TTL has elapsed', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(100);
    const { transport, repo } = setup();
    const release = pauseNextRead(transport);
    const first = repo.listLibrary();
    now.mockReturnValue(20_000);
    const second = repo.listLibrary();
    release();
    await Promise.all([first, second]);
    expect(transport.reads).toBe(1);
  });

  it('retention starts when the provider read completes and expires afterward', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(100);
    const { transport, repo } = setup();
    const release = pauseNextRead(transport);
    const first = repo.listLibrary();
    now.mockReturnValue(20_000);
    release();
    await first;
    now.mockReturnValue(20_001);
    await repo.listLibrary();
    expect(transport.reads).toBe(1);
    now.mockReturnValue(35_001);
    await repo.listLibrary();
    expect(transport.reads).toBe(2);
  });

  it('a write invalidates all dependent tabs and the next read calls the provider', async () => {
    const { transport, repo } = setup();
    const [library] = await Promise.all([repo.getLibrary('SYN-L001'), repo.listReadyQueue(), repo.listSchedule()]);
    const result = await repo.updateLibrary({
      operationId: 'op_cache_write_126', actor: { sub: 'synthetic-owner', role: 'owner' },
      target: { libraryId: 'SYN-L001' }, expectedRevision: library.revision,
      patch: { draftContent: 'Synthetic updated draft' },
    });
    expect(result.ok).toBe(true);
    const reads = transport.reads;
    const [fresh] = await Promise.all([repo.getLibrary('SYN-L001'), repo.listReadyQueue(), repo.listSchedule()]);
    expect(fresh.value.draftContent).toBe('Synthetic updated draft');
    expect(transport.reads - reads).toBe(3);
  });

  it('stale-revision validation reads fresh instead of accepting the cached revision', async () => {
    const { transport, repo } = setup();
    const library = await repo.getLibrary('SYN-L001');
    const col = transport.rawTab(SHEET_TABS.library.name)[0]!.findIndex((cell) => cell.value === 'Draft Content');
    transport.externalEdit(SHEET_TABS.library.name, library.row, col, 'Synthetic external edit');
    expect((await repo.getLibrary('SYN-L001')).revision).toBe(library.revision);
    const reads = transport.reads;
    const result = await repo.updateLibrary({
      operationId: 'op_cache_stale_126', actor: { sub: 'synthetic-owner', role: 'owner' },
      target: { libraryId: 'SYN-L001' }, expectedRevision: library.revision,
      patch: { draftContent: 'Synthetic proposed edit' },
    });
    expect(result).toMatchObject({ ok: false, code: 'STALE_READ' });
    expect(transport.reads - reads).toBe(1);
    expect(transport.writes).toHaveLength(0);
    expect((await repo.getLibrary('SYN-L001')).value.draftContent).toBe('Synthetic external edit');
  });

  it.each([false, true])('an invalidated pending read cannot replace or evict a newer snapshot (failure=%s)', async (fail) => {
    const { transport, repo } = setup();
    const library = await repo.getLibrary('SYN-L001');
    // Expire the old snapshot, then hold an old provider result across a write.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 20_000);
    const release = pauseNextRead(transport, fail);
    const old = repo.listLibrary().catch(() => []);
    const result = await repo.updateLibrary({
      operationId: 'op_cache_race_126', actor: { sub: 'synthetic-owner', role: 'owner' },
      target: { libraryId: 'SYN-L001' }, expectedRevision: library.revision,
      patch: { draftContent: 'Synthetic newer snapshot' },
    });
    expect(result.ok).toBe(true);
    await repo.listLibrary();
    const reads = transport.reads;
    release();
    await old;
    expect((await repo.getLibrary('SYN-L001')).value.draftContent).toBe('Synthetic newer snapshot');
    expect(transport.reads).toBe(reads);
  });

  it('failed reads are evicted so the next request retries', async () => {
    const { transport, repo } = setup();
    transport.failNext({ op: 'read', code: 'RATE_LIMITED' });
    await expect(repo.listLibrary()).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect((await repo.listLibrary()).length).toBeGreaterThan(0);
    expect(transport.reads).toBe(2);
  });

  it('header-only schema reads are counted by the same telemetry as paged reads', async () => {
    const { transport, repo } = setup();
    const events: TelemetryEvent[] = [];
    setTelemetrySink((event) => events.push(event));
    expect((await repo.schema()).ok).toBe(true);
    expect(events.filter((event) => event.name === 'sheet.read')).toHaveLength(transport.reads);
    expect(events.every((event) => event.facts?.maxRows === 1)).toBe(true);
  });

  it('adapter Calls count provider reads/writes without counting mutation result events twice', async () => {
    const { transport, repo } = setup();
    const events: (TelemetryEvent & { at: string })[] = [];
    setTelemetrySink((event) => events.push(event));
    const library = await repo.getLibrary('SYN-L001');
    expect((await repo.updateLibrary({
      operationId: 'op_cache_count_126', actor: { sub: 'synthetic-owner', role: 'owner' },
      target: { libraryId: 'SYN-L001' }, expectedRevision: library.revision,
      patch: { draftContent: 'Synthetic counted write' },
    })).ok).toBe(true);
    expect(summariseEvents(events).find((event) => event.adapter === 'sheet')?.total)
      .toBe(transport.reads + transport.writes.length);
  });

  it('Workflow Settings reads only its Setting, Value and Notes columns', async () => {
    const { transport, repo } = setup();
    const read = vi.spyOn(transport, 'readTab');
    expect((await repo.workflowSettings()).problems).toEqual([]);
    expect(read).toHaveBeenCalledWith(SHEET_TABS.settings.name, 'C', expect.anything());
  });
});
