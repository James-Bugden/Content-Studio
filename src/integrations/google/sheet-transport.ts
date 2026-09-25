import 'server-only';
import type { RawRow } from '@/domain/mapping';

/**
 * Lowest Sheet layer: bounded reads of one tab and named-cell writes.
 * The repository above it does header discovery, mapping, conflict checks and
 * idempotency, so the same logic runs over the Google API and the in-memory fake.
 */
export type CellWrite = { row: number; column: number; value: string | boolean };

export type ReadOptions = {
  /** 1-based first row to read. */
  startRow: number;
  /** Maximum rows to read in total (pagination bound). */
  maxRows: number;
  /** Also fetch formulas (for formula detection and HYPERLINK targets). */
  formulas: boolean;
  /** Also fetch cell hyperlinks (rich links that have no formula). */
  links: boolean;
};

export interface SheetTransport {
  readonly mode: 'fake' | 'live';
  readTab(tab: string, lastColumn: string, options: ReadOptions): Promise<RawRow[]>;
  writeCells(tab: string, writes: CellWrite[]): Promise<void>;
  /** Atomically appends a row after the tab's current data region. */
  appendRow(tab: string, lastColumn: string, values: readonly (string | boolean)[]): Promise<void>;
}

/** Page size for bounded reads. */
export const PAGE_ROWS = 500;
/** Hard cap: a tab larger than this is refused rather than read unbounded. */
export const MAX_TAB_ROWS = 10_000;
