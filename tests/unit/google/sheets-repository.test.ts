import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '@/domain/errors';
import { FakeSheetTransport } from '@/integrations/google/fake-sheet';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';
import { SHEET_TABS, LIBRARY_HEADERS } from '@/domain/sheet-schema';
import { setTelemetrySink, type TelemetryEvent } from '@/observability/events';
import { largeLibraryRows, syntheticLibraryRows } from '@/fixtures/synthetic';
import type { Actor } from '@/domain/mutation';

const owner: Actor = { sub: '100000000000000000001', role: 'owner' };
const viewer: Actor = { sub: '100000000000000000002', role: 'viewer' };
let events: (TelemetryEvent & { at: string })[];
let transport: FakeSheetTransport;
let repo: SheetsContentRepository;

beforeEach(() => {
  events = [];
  setTelemetrySink((e) => events.push(e));
  transport = new FakeSheetTransport();
  repo = new SheetsContentRepository(transport);
});
afterEach(() => setTelemetrySink(null));

const op = (n: string) => `op_${n}_000000`;

describe('MAP-03 / MAP-04: schema discovery', () => {
  it('reports all three tabs healthy for the synthetic workbook', async () => {
    const s = await repo.schema();
    expect(s.ok).toBe(true);
    expect(s.tabs.map((t) => t.tab)).toEqual(['Content Library', 'Ready Queue', 'Content Schedule']);
  });

  it('renamed required column gives SCHEMA_DRIFT and no write', async () => {
    const lib = await repo.getLibrary('SYN-L001');
    const header = transport.rawTab(SHEET_TABS.library.name)[0]!;
    const col = header.findIndex((c) => c.value === LIBRARY_HEADERS.reviewStatus);
    transport.externalEdit(SHEET_TABS.library.name, 1, col, 'Review state');
    await expect(repo.listLibrary()).rejects.toMatchObject({ code: 'SCHEMA_DRIFT' });
    const r = await repo.updateLibrary({ operationId: op('drift'), actor: owner, target: { libraryId: 'SYN-L001' }, expectedRevision: lib.revision, patch: { reviewStatus: 'Approved' } });
    expect(r).toMatchObject({ ok: false, code: 'SCHEMA_DRIFT' });
    expect(transport.writes).toHaveLength(0);
  });

  it('works with an unknown extra column and preserves it on write', async () => {
    const tab = SHEET_TABS.library.name;
    const width = transport.rawTab(tab)[0]!.length;
    transport.externalEdit(tab, 1, width, 'Owner notes');
    transport.externalEdit(tab, 2, width, 'keep me');
    const lib = await repo.getLibrary('SYN-L001');
    const r = await repo.updateLibrary({ operationId: op('extra'), actor: owner, target: { libraryId: 'SYN-L001' }, expectedRevision: lib.revision, patch: { reviewStatus: 'Approved' } });
    expect(r.ok).toBe(true);
    expect(transport.rawTab(tab)[1]![width]!.value).toBe('keep me');
    expect(transport.writes[0]!.writes).toHaveLength(1);
  });
});

describe('READY-02: Ready Queue is derived, never written', () => {
  it('matches approved and queued Library rows', async () => {
    const ready = (await repo.listReadyQueue()).map((r) => r.value.libraryId).sort();
    const lib = (await repo.listLibrary())
      .filter((r) => r.value.reviewStatus.ok && r.value.reviewStatus.value === 'Approved' && r.value.queueForSchedule === true)
      .map((r) => r.value.libraryId)
      .sort();
    expect(ready).toEqual(lib);
    expect(ready).toContain('SYN-L005');
    expect(ready).not.toContain('SYN-L010');
  });

  it('the repository exposes no write path for Ready Queue', () => {
    expect(Object.getOwnPropertyNames(SheetsContentRepository.prototype).filter((n) => /ready/i.test(n))).toEqual(['listReadyQueue']);
  });
});

describe('REV-02: conflict-safe writes', () => {
  it('writes only the named cells', async () => {
    const lib = await repo.getLibrary('SYN-L001');
    const r = await repo.updateLibrary({ operationId: op('named'), actor: owner, target: { libraryId: 'SYN-L001' }, expectedRevision: lib.revision, patch: { reviewStatus: 'Approved', queueForSchedule: 'TRUE' } });
    expect(r.ok).toBe(true);
    expect(transport.writes[0]!.writes.map((w) => w.row)).toEqual([lib.row, lib.row]);
    expect(transport.writes[0]!.writes.find((w) => typeof w.value === 'boolean')?.value).toBe(true);
    if (r.ok) expect(r.value.revision).not.toBe(lib.revision);
  });

  it('an external change after load produces STALE_READ and keeps both versions', async () => {
    const lib = await repo.getLibrary('SYN-L001');
    const header = transport.rawTab(SHEET_TABS.library.name)[0]!;
    const draftCol = header.findIndex((c) => c.value === 'Draft Content');
    transport.externalEdit(SHEET_TABS.library.name, lib.row, draftCol, 'Edited directly in the Sheet');
    const r = await repo.updateLibrary({ operationId: op('stale'), actor: owner, target: { libraryId: 'SYN-L001' }, expectedRevision: lib.revision, patch: { draftContent: 'My edit' } });
    expect(r).toMatchObject({ ok: false, code: 'STALE_READ' });
    expect(transport.writes).toHaveLength(0);
    expect((await repo.getLibrary('SYN-L001')).value.draftContent).toBe('Edited directly in the Sheet');
  });

  it('a lost response replays as already applied instead of conflicting', async () => {
    const lib = await repo.getLibrary('SYN-L001');
    const m = { operationId: op('lost'), actor: owner, target: { libraryId: 'SYN-L001' }, expectedRevision: lib.revision, patch: { reviewStatus: 'Approved' } };
    const first = await repo.updateLibrary(m);
    expect(first.ok).toBe(true);
    const fresh = new SheetsContentRepository(transport); // new instance: no op cache, like another server instance
    const again = await fresh.updateLibrary(m);
    expect(again).toMatchObject({ ok: true, replayed: true });
    expect(transport.writes).toHaveLength(1);
  });

  it('same operation id with a different patch is a conflict', async () => {
    const lib = await repo.getLibrary('SYN-L001');
    await repo.updateLibrary({ operationId: op('reuse'), actor: owner, target: { libraryId: 'SYN-L001' }, expectedRevision: lib.revision, patch: { reviewStatus: 'Approved' } });
    const r = await repo.updateLibrary({ operationId: op('reuse'), actor: owner, target: { libraryId: 'SYN-L001' }, expectedRevision: lib.revision, patch: { reviewStatus: 'Skipped' } });
    expect(r).toMatchObject({ ok: false, code: 'CONFLICT' });
  });

  it('never writes a formula cell', async () => {
    const lib = await repo.getLibrary('SYN-L002');
    expect(lib.formulaFields).toContain('nextAction');
    const r = await repo.updateLibrary({ operationId: op('formula'), actor: owner, target: { libraryId: 'SYN-L002' }, expectedRevision: lib.revision, patch: { nextAction: 'x' } });
    expect(r).toMatchObject({ ok: false, code: 'VALIDATION_FAILED', details: { reason: 'formula_cell' } });
    expect(transport.writes).toHaveLength(0);
  });
});

describe('SEC-03: validation', () => {
  it.each([
    ['viewer actor', { actor: viewer }, 'FORBIDDEN'],
    ['bad operation id', { operationId: 'x' }, 'VALIDATION_FAILED'],
    ['non-writable field', { patch: { libraryId: 'SYN-HIJACK' } }, 'VALIDATION_FAILED'],
    ['oversized value', { patch: { draftContent: 'a'.repeat(50_001) } }, 'VALIDATION_FAILED'],
    ['empty patch', { patch: {} }, 'VALIDATION_FAILED'],
  ] as const)('%s', async (_name, override, code) => {
    const lib = await repo.getLibrary('SYN-L001');
    const r = await repo.updateLibrary({ operationId: op('val'), actor: owner, target: { libraryId: 'SYN-L001' }, expectedRevision: lib.revision, patch: { reviewStatus: 'Approved' }, ...override } as never);
    expect(r).toMatchObject({ ok: false, code });
    expect(transport.writes).toHaveLength(0);
  });

  it('unknown id is NOT_FOUND', async () => {
    const r = await repo.updateLibrary({ operationId: op('missing'), actor: owner, target: { libraryId: 'SYN-NOPE' }, expectedRevision: '0000000000000000', patch: { reviewStatus: 'Approved' } });
    expect(r).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });

  it('SEC-08: read-only repository refuses every write', async () => {
    const ro = new SheetsContentRepository(transport, { writable: false });
    expect(ro.capability().state).toBe('read_only');
    const lib = await ro.getLibrary('SYN-L001');
    const r = await ro.updateLibrary({ operationId: op('ro'), actor: owner, target: { libraryId: 'SYN-L001' }, expectedRevision: lib.revision, patch: { reviewStatus: 'Approved' } });
    expect(r).toMatchObject({ ok: false, code: 'CONFIG_MISSING' });
  });
});

describe('OBS-02: observable and redacted', () => {
  it('records latency and outcome without copy or raw ids', async () => {
    const lib = await repo.getLibrary('SYN-L008');
    await repo.updateLibrary({ operationId: op('obs'), actor: owner, target: { libraryId: 'SYN-L008' }, expectedRevision: lib.revision, patch: { draftContent: 'SECRET_COPY_SENTINEL body' } });
    const text = JSON.stringify(events);
    expect(text).not.toContain('SECRET_COPY_SENTINEL');
    expect(text).not.toContain('SYN-L008');
    expect(text).not.toContain('談薪水');
    expect(events.some((e) => e.name === 'sheet.read' && typeof e.latencyMs === 'number')).toBe(true);
    expect(events.some((e) => e.name === 'sheet.update.library' && e.outcome === 'ok' && e.targetHash)).toBe(true);
  });

  it('rate limiting surfaces as RATE_LIMITED, not as an empty result', async () => {
    transport.failNext({ op: 'read', code: 'RATE_LIMITED' });
    await expect(repo.listLibrary()).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(events.some((e) => e.outcome === 'error' && e.code === 'RATE_LIMITED')).toBe(true);
  });

  it('a failed write is reported with its code', async () => {
    const lib = await repo.getLibrary('SYN-L001');
    transport.failNext({ op: 'write', code: 'PROVIDER_UNAVAILABLE' });
    const r = await repo.updateLibrary({ operationId: op('wfail'), actor: owner, target: { libraryId: 'SYN-L001' }, expectedRevision: lib.revision, patch: { reviewStatus: 'Approved' } });
    expect(r).toMatchObject({ ok: false, code: 'PROVIDER_UNAVAILABLE' });
  });
});

describe('fixtures: pagination, empty queue, settings', () => {
  it('reads a 1,600-row corpus across pages', async () => {
    const big = new SheetsContentRepository(new FakeSheetTransport({ [SHEET_TABS.library.name]: largeLibraryRows(1600) }));
    const rows = await big.listLibrary();
    expect(rows).toHaveLength(1600);
    expect(rows.at(-1)!.value.libraryId).toBe('SYN-B1600');
  });

  it('a tab whose row count lands exactly on a page boundary still reads to the end', async () => {
    // 1999 data rows + the header row is 2000 total, an exact multiple of PAGE_ROWS (500). The
    // last full page (rows 1501-2000) ends exactly at the tab's real grid size, so the next
    // page request starts past it. Google answers that with 400 "Unable to parse range", which
    // the live transport reports as VALIDATION_FAILED; this must read as end-of-data, not fail
    // the whole board (a real regression seen against a live Sheet this size).
    const grid = largeLibraryRows(1999).map((r) => r.values);
    const boundary = new (class {
      readonly mode = 'live' as const;
      async readTab(tab: string, _lastColumn: string, options: { startRow: number; maxRows: number }) {
        if (tab !== SHEET_TABS.library.name) throw new AppError('SCHEMA_DRIFT', { provider: 'sheet' });
        if (options.startRow - 1 >= grid.length) throw new AppError('VALIDATION_FAILED', { provider: 'sheet', status: 400 });
        return grid.slice(options.startRow - 1, options.startRow - 1 + options.maxRows).map((values) => ({ values }));
      }
      async writeCells(): Promise<void> {
        throw new AppError('FORBIDDEN', { provider: 'sheet' });
      }
    })();
    const atBoundary = new SheetsContentRepository(boundary);
    const rows = await atBoundary.listLibrary();
    expect(rows).toHaveLength(1999);
    expect(rows.at(-1)!.value.libraryId).toBe('SYN-B1999');
  });

  it('empty Ready Queue is an empty list, not an error', async () => {
    const [header] = syntheticLibraryRows();
    const empty = new SheetsContentRepository(new FakeSheetTransport({ [SHEET_TABS.readyQueue.name]: [header!] }));
    expect(await empty.listReadyQueue()).toEqual([]);
  });

  it('parses current Taipei slot policy and cadence rows', async () => {
    const s = await repo.workflowSettings();
    expect(s.problems).toEqual([]);
    expect(s.slots).toContainEqual({ platform: 'Threads', slot: '3rd', time: 'TBD' });
    expect(s.slots).toContainEqual({ platform: 'X', slot: '3rd', time: 'TBD' });
    expect(s.slots).toContainEqual({ platform: 'LinkedIn', slot: 'Main', time: '21:00' });
    expect(s.slots).toHaveLength(7);
    expect(s.raw['Monday cadence']).toBe('X/Threads AM: Personal story | PM: Expertise');
    expect(s.raw['Friday cadence']).toBe('X/Threads AM: Build in public (Soar) | PM: Expertise');
  });

  it('queue summary counts come from the Sheet', async () => {
    const q = await repo.queueSummary();
    expect(q[0]).toMatchObject({ source: 'Synthetic Negotiation Handbook', counts: { Total: 12, Queued: 4 } });
    expect(q[0]!.masterLink).toMatch(/^https:\/\/drive\.google\.com\//);
  });
});

describe('live read cache', () => {
  it('shares reads within the TTL, and a write reads fresh and clears it', async () => {
    const t = new FakeSheetTransport();
    const cached = new SheetsContentRepository(t, { writable: true, readCacheMs: 60_000 });
    await cached.listLibrary();
    const reads = t.reads;
    await cached.listLibrary();
    await Promise.all([cached.listLibrary(), cached.listLibrary()]);
    expect(t.reads).toBe(reads);
    // An external edit is invisible to cached reads, but a write re-reads fresh and detects it.
    const lib = await cached.getLibrary('SYN-L001');
    const col = t.rawTab('Content Library')[0]!.findIndex((c) => c.value === 'Draft Content');
    t.externalEdit('Content Library', lib.row, col, 'edited elsewhere');
    const r = await cached.updateLibrary({ operationId: 'op_cache_stale_1', actor: owner, target: { libraryId: 'SYN-L001' }, expectedRevision: lib.revision, patch: { reviewStatus: 'Approved' } });
    expect(r).toMatchObject({ ok: false, code: 'STALE_READ' });
    const fresh = await cached.getLibrary('SYN-L001');
    const ok = await cached.updateLibrary({ operationId: 'op_cache_ok_1', actor: owner, target: { libraryId: 'SYN-L001' }, expectedRevision: fresh.revision, patch: { reviewStatus: 'Approved' } });
    expect(ok.ok).toBe(true);
    expect((await cached.getLibrary('SYN-L001')).cells.reviewStatus).toBe('Approved');
  });
});
