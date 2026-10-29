import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeSheetTransport } from '@/integrations/google/fake-sheet';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';
import { FakeTypefullyGateway } from '@/integrations/typefully/fake-gateway';
import { buildReconcileReport, startReconcile, TYPEFULLY_SCAN_MAX } from '@/application/reconcile';
import { cachedNavigationCounts } from '@/application/navigation-counts';
import type { ContentRepository, DriveGateway } from '@/application/ports';
import type { LibraryRecord, ScheduleRecord } from '@/domain/records';
import { setTelemetrySink } from '@/observability/events';

const LATENCY = 150;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const NOW = Date.parse('2026-10-05T00:00:00+08:00');

beforeEach(() => { process.env.CS_FAKE_TODAY = '2026-09-30'; setTelemetrySink(() => undefined); });
afterEach(() => { setTelemetrySink(null); delete process.env.CS_FAKE_TODAY; vi.restoreAllMocks(); });

/** Drive double: one latency per call, counts reads per file. */
function latencyDrive(opts: { latency?: number; fail?: (id: string) => boolean; hang?: (id: string) => boolean } = {}) {
  const reads: string[] = [];
  const drive = {
    capability: () => ({ provider: 'drive', mode: 'fake', state: 'ready' }),
    async readText(fileId: string) {
      reads.push(fileId);
      if (opts.hang?.(fileId)) return new Promise<never>(() => undefined);
      await sleep(opts.latency ?? LATENCY);
      if (opts.fail?.(fileId)) throw new Error('synthetic drive failure');
      return { text: '# nothing\n', meta: {} };
    },
  } as unknown as DriveGateway;
  return { drive, reads };
}

/** Typefully fake with a latency on every provider call. */
function latencyTypefully() {
  const inner = new FakeTypefullyGateway([], () => new Date('2026-09-30T00:00:00Z'));
  let inFlight = 0;
  let peak = 0;
  const gateway = new Proxy(inner, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      if (prop === 'capability') return value.bind(target);
      return async (...args: unknown[]) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        try {
          await sleep(LATENCY);
          return await (value as (...a: unknown[]) => unknown).apply(target, args);
        } finally {
          inFlight--;
        }
      };
    },
  });
  return { gateway, inner, peak: () => peak };
}

/** Distinct Content IDs inside the 7-day scan window: 8 dates x 3 slots x 3 platforms. */
const dueId = (i: number) => `${new Date(Date.UTC(2026, 8, 30 + (i % 8))).toISOString().slice(0, 10)}-${['MAIN', '2ND', '3RD'][Math.floor(i / 8) % 3]}-${['X', 'TH', 'LI'][Math.floor(i / 24) % 3]}`;

/** The synthetic repository plus extra Library rows on distinct master files and extra Ready Schedule rows. */
function repoWith({ files, due }: { files: number; due: number }) {
  const base = new SheetsContentRepository(new FakeSheetTransport());
  let revision = 0;
  const overrides: Record<string, unknown> = {
    async listLibrary(): Promise<LibraryRecord[]> {
      const rows = await base.listLibrary();
      const template = rows.find((r) => r.value.libraryId === 'SYN-L001')!;
      const extra = Array.from({ length: files }, (_, i): LibraryRecord => {
        const url = `https://drive.google.com/file/d/SYNTH_extra_${i}/view`;
        return {
          ...template,
          revision: `r${revision}-${i}`,
          value: { ...template.value, libraryId: `SYN-X${String(i).padStart(3, '0')}`, draftContent: 'body' },
          links: { ...template.links, sourceMarkdown: url, sourceMasterFile: url },
          cells: { ...template.cells, sourceMarkdown: url, sourceMasterFile: url },
        };
      });
      return [...rows, ...extra];
    },
    async listSchedule(): Promise<ScheduleRecord[]> {
      const rows = await base.listSchedule();
      const template = rows.find((r) => r.value.platform?.ok && r.value.platform.value === 'X')!;
      const extra = Array.from({ length: due }, (_, i): ScheduleRecord => ({
        ...template,
        revision: `s${revision}-${i}`,
        value: { ...template.value, contentId: dueId(i), typefullyDraftId: '', contentStage: { ok: true, value: 'Ready' } } as ScheduleRecord['value'],
      }));
      return [...rows, ...extra];
    },
  };
  const repo = new Proxy(base, {
    get(target, prop) {
      if (typeof prop === 'string' && prop in overrides) return overrides[prop];
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as unknown as ContentRepository;
  return { repo, bump: () => { revision++; } };
}

describe('CS #250: Fix issues parallel provider reads', () => {
  it('reads each Drive master file once, in parallel (total time well under the serial sum)', async () => {
    const { repo } = repoWith({ files: 15, due: 0 });
    const { drive, reads } = latencyDrive();
    const started = Date.now();
    const report = await buildReconcileReport(repo, drive, NOW);
    const elapsed = Date.now() - started;
    const unique = new Set(reads);
    expect(reads.length).toBe(unique.size);
    expect(unique.size).toBeGreaterThanOrEqual(15);
    expect(elapsed).toBeLessThan(unique.size * LATENCY * 0.5);
    expect(report.items.some((i) => i.stableIds[0]?.startsWith('SYN-X'))).toBe(true);
  });

  it('scans Typefully with bounded concurrency, capped at the maximum', async () => {
    const { repo } = repoWith({ files: 0, due: 70 });
    const { gateway, inner, peak } = latencyTypefully();
    const { drive } = latencyDrive({ latency: 0 });
    const started = Date.now();
    const section = await startReconcile(repo, drive, NOW, { typefully: gateway, today: '2026-09-30' }).typefully;
    const elapsed = Date.now() - started;
    expect(section.checked).toBe(TYPEFULLY_SCAN_MAX);
    expect(peak()).toBeLessThanOrEqual(5);
    expect(peak()).toBeGreaterThan(1);
    expect(inner.calls.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(TYPEFULLY_SCAN_MAX * LATENCY * 0.5);
  });

  it('a Drive file that errors or hangs only affects its own section and rows', async () => {
    const { repo } = repoWith({ files: 4, due: 0 });
    const { drive } = latencyDrive({ latency: 5, fail: (id) => id === 'SYNTH_extra_1', hang: (id) => id === 'SYNTH_extra_2' });
    const start = startReconcile(repo, drive, NOW, { providerTimeoutMs: 80 });
    const fast = await start.fast;
    const section = await start.drive;
    expect(fast.items.length).toBeGreaterThan(0);
    expect(section.failed).toBe(2);
    expect(section.unreadable).toHaveLength(2);
    expect(section.checked).toBeGreaterThanOrEqual(4);
  });

  it('the database checks resolve while a hanging provider is still pending', async () => {
    const { repo } = repoWith({ files: 2, due: 0 });
    const { drive } = latencyDrive({ hang: () => true });
    const start = startReconcile(repo, drive, NOW, { providerTimeoutMs: 5_000 });
    let driveSettled = false;
    void start.drive.then(() => { driveSettled = true; });
    const fast = await start.fast;
    expect(fast.items.some((i) => i.kind === 'stale_approval')).toBe(true);
    expect(driveSettled).toBe(false);
    // The nav badge stays unknown (null), never a partial number, until every part is known.
    expect(cachedNavigationCounts(repo).fixIssues).toBeNull();
  });
});

describe('CS #250: brief reuse of slow results', () => {
  it('reuses Drive and Typefully work within the ttl, and not after fresh or a data change', async () => {
    const { repo, bump } = repoWith({ files: 3, due: 3 });
    const { drive, reads } = latencyDrive({ latency: 1 });
    const { gateway, inner } = latencyTypefully();
    const run = (cache: { ttlMs: number; fresh?: boolean }) => startReconcile(repo, drive, NOW, { typefully: gateway, today: '2026-09-30', cache }).report;
    await run({ ttlMs: 60_000 });
    const driveCalls = reads.length;
    const tfCalls = inner.calls.length;
    expect(driveCalls).toBeGreaterThan(0);
    await run({ ttlMs: 60_000 });
    expect(reads.length).toBe(driveCalls);
    expect(inner.calls.length).toBe(tfCalls);
    await run({ ttlMs: 60_000, fresh: true });
    expect(reads.length).toBe(driveCalls * 2);
    bump();
    await run({ ttlMs: 60_000 });
    expect(reads.length).toBe(driveCalls * 3);
  });

  it('never reuses a failed result, and expires after the ttl', async () => {
    const { repo } = repoWith({ files: 2, due: 0 });
    let fail = true;
    const { drive, reads } = latencyDrive({ latency: 1, fail: () => fail });
    const run = () => startReconcile(repo, drive, NOW, { cache: { ttlMs: 60_000 } }).drive;
    expect((await run()).failed).toBeGreaterThan(0);
    const after = reads.length;
    fail = false;
    expect((await run()).failed).toBe(0);
    expect(reads.length).toBeGreaterThan(after);
    const settled = reads.length;
    await run();
    expect(reads.length).toBe(settled);
    const real = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(real + 60_001);
    await run();
    expect(reads.length).toBeGreaterThan(settled);
  });

  it('is off unless asked: two plain builds read twice', async () => {
    const { repo } = repoWith({ files: 2, due: 0 });
    const { drive, reads } = latencyDrive({ latency: 1 });
    await buildReconcileReport(repo, drive, NOW);
    const once = reads.length;
    await buildReconcileReport(repo, drive, NOW);
    expect(reads.length).toBe(once * 2);
  });
});

describe('CS #250: navigation badge', () => {
  it('uses the remembered count only and never starts the slow scan', async () => {
    const { repo } = repoWith({ files: 3, due: 3 });
    const { drive, reads } = latencyDrive({ latency: 1 });
    const { gateway, inner } = latencyTypefully();
    expect(cachedNavigationCounts(repo)).toMatchObject({ fixIssues: null });
    expect(reads.length + inner.calls.length).toBe(0);
    const report = await startReconcile(repo, drive, NOW, { typefully: gateway, today: '2026-09-30' }).report;
    const before = { drive: reads.length, tf: inner.calls.length };
    for (let i = 0; i < 5; i++) cachedNavigationCounts(repo);
    expect({ drive: reads.length, tf: inner.calls.length }).toEqual(before);
    expect(cachedNavigationCounts(repo).fixIssues).toBe(report.items.filter((i) => i.severity === 'blocking').length);
  });
});
