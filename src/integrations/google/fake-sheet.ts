import 'server-only';
import { AppError, type ErrorCode } from '@/domain/errors';
import type { RawRow } from '@/domain/mapping';
import {
  syntheticLibraryRows,
  syntheticQueueRows,
  syntheticQueueSummaryRows,
  syntheticReadyQueueRows,
  syntheticScheduleRows,
  syntheticSettingsRows,
} from '@/fixtures/synthetic';
import { SHEET_TABS, LIBRARY_HEADERS, discoverHeaders } from '@/domain/sheet-schema';
import type { CellWrite, ReadOptions, SheetTransport } from './sheet-transport';

/**
 * In-memory Sheet with failure injection. Formulas are kept per cell and a write
 * to a formula cell replaces it, exactly like the real API, so repository tests
 * prove the repository refuses such writes rather than the fake hiding them.
 *
 * `Ready Queue` is recomputed from `Content Library` on every read, mirroring the
 * live sheet where it is a formula view.
 */
type Cell = { value: string; formula?: string; link?: string };

export type FakeFailure = { op: 'read' | 'write'; tab?: string; code: ErrorCode; times?: number };

export class FakeSheetTransport implements SheetTransport {
  readonly mode = 'fake' as const;
  private tabs = new Map<string, Cell[][]>();
  private failures: FakeFailure[] = [];
  readonly writes: { tab: string; writes: CellWrite[] }[] = [];
  reads = 0;
  /** A seeded Ready Queue is kept as-is (to test drift between the view and the Library). */
  private readonly readyQueuePinned: boolean;
  /** Called after the repository's pre-write read and before its write, to simulate a concurrent edit. */
  beforeWrite: ((tab: string) => void) | null = null;

  constructor(seed?: Partial<Record<string, RawRow[]>>) {
    const initial: Record<string, RawRow[]> = {
      [SHEET_TABS.library.name]: syntheticLibraryRows(),
      [SHEET_TABS.queue.name]: syntheticQueueRows(),
      [SHEET_TABS.schedule.name]: syntheticScheduleRows(),
      [SHEET_TABS.queueSummary.name]: syntheticQueueSummaryRows(),
      [SHEET_TABS.settings.name]: syntheticSettingsRows(),
      ...seed,
    } as Record<string, RawRow[]>;
    for (const [tab, rows] of Object.entries(initial)) this.tabs.set(tab, rows.map(toCells));
    this.readyQueuePinned = Boolean(seed?.[SHEET_TABS.readyQueue.name]);
    if (!this.readyQueuePinned) this.tabs.set(SHEET_TABS.readyQueue.name, syntheticReadyQueueRows().map(toCells));
  }

  failNext(failure: FakeFailure): void {
    this.failures.push({ times: 1, ...failure });
  }

  private maybeFail(op: 'read' | 'write', tab: string): void {
    const i = this.failures.findIndex((f) => f.op === op && (!f.tab || f.tab === tab));
    if (i < 0) return;
    const f = this.failures[i]!;
    f.times = (f.times ?? 1) - 1;
    if (f.times <= 0) this.failures.splice(i, 1);
    throw new AppError(f.code, { provider: 'sheet', injected: true });
  }

  /** Simulate an edit made directly in the Sheet (by James or another tool). */
  externalEdit(tab: string, row: number, column: number, value: string): void {
    const grid = this.tabs.get(tab)!;
    while (grid.length < row) grid.push([]);
    const r = grid[row - 1]!;
    while (r.length <= column) r.push({ value: '' });
    r[column] = { value };
  }

  rawTab(tab: string): Cell[][] {
    return this.tabs.get(tab) ?? [];
  }

  async readTab(tab: string, _lastColumn: string, options: ReadOptions): Promise<RawRow[]> {
    this.reads += 1;
    this.maybeFail('read', tab);
    if (tab === SHEET_TABS.readyQueue.name && !this.readyQueuePinned) this.recomputeReadyQueue();
    const grid = this.tabs.get(tab);
    if (!grid) throw new AppError('SCHEMA_DRIFT', { provider: 'sheet', missingTab: true });
    const slice = grid.slice(options.startRow - 1, options.startRow - 1 + options.maxRows);
    return slice.map((cells) => ({
      values: cells.map((c) => c.value),
      ...(options.formulas ? { formulas: cells.map((c) => c.formula ?? c.value) } : {}),
      ...(options.links ? { links: cells.map((c) => c.link ?? null) } : {}),
    }));
  }

  async writeCells(tab: string, writes: CellWrite[]): Promise<void> {
    this.beforeWrite?.(tab);
    this.maybeFail('write', tab);
    const grid = this.tabs.get(tab);
    if (!grid) throw new AppError('SCHEMA_DRIFT', { provider: 'sheet', missingTab: true });
    for (const w of writes) {
      while (grid.length < w.row) grid.push([]);
      const r = grid[w.row - 1]!;
      while (r.length <= w.column) r.push({ value: '' });
      r[w.column] = { value: typeof w.value === 'boolean' ? (w.value ? 'TRUE' : 'FALSE') : w.value };
    }
    this.writes.push({ tab, writes });
  }

  async appendRow(tab: string, _lastColumn: string, values: readonly (string | boolean)[]): Promise<void> {
    this.beforeWrite?.(tab);
    this.maybeFail('write', tab);
    const grid = this.tabs.get(tab);
    if (!grid) throw new AppError('SCHEMA_DRIFT', { provider: 'sheet', missingTab: true });
    grid.push(values.map((value) => ({ value: typeof value === 'boolean' ? (value ? 'TRUE' : 'FALSE') : value })));
    this.writes.push({
      tab,
      writes: values.map((value, column) => ({ row: grid.length, column, value })),
    });
  }

  private recomputeReadyQueue(): void {
    const lib = this.tabs.get(SHEET_TABS.library.name) ?? [];
    const header = lib[0]?.map((c) => c.value) ?? [];
    const found = discoverHeaders(LIBRARY_HEADERS, header);
    if (!found.ok) return;
    const { reviewStatus, queueForSchedule } = found.index.columns;
    const rows = lib.slice(1).filter((r) => r[reviewStatus]?.value === 'Approved' && r[queueForSchedule]?.value === 'TRUE');
    this.tabs.set(SHEET_TABS.readyQueue.name, [lib[0] ?? [], ...rows.map((r) => r.map((c) => ({ value: c.value })))]);
  }
}

function toCells(row: RawRow): Cell[] {
  return row.values.map((value, i) => {
    const formula = row.formulas?.[i];
    const link = row.links?.[i];
    return {
      value: String(value ?? ''),
      ...(typeof formula === 'string' && formula.startsWith('=') ? { formula } : {}),
      ...(typeof link === 'string' && link ? { link } : {}),
    };
  });
}
