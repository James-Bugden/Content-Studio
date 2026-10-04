import 'server-only';
import type { RawRow } from '@/domain/mapping';
import { columnLetter } from '@/domain/sheet-schema';
import { SCOPES, googleError, withReadRetry, type ServiceAccountTokens } from './service-account';
import type { CellWrite, ReadOptions, SheetTransport } from './sheet-transport';

/**
 * Google Sheets REST transport (CS-003). Reads formatted values plus formulas and
 * hyperlinks for the bounded range in one request; writes named cells with RAW input so a value
 * that starts with `=` is stored as text, never evaluated (formula injection).
 */
const API = 'https://sheets.googleapis.com/v4/spreadsheets';

function quoteTab(tab: string): string {
  return `'${tab.replace(/'/g, "''")}'`;
}

type GridCell = {
  formattedValue?: string;
  userEnteredValue?: { formulaValue?: string; stringValue?: string; numberValue?: number; boolValue?: boolean; errorValue?: unknown };
  hyperlink?: string;
};

function trimEnd<T>(cells: T[], empty: (cell: T) => boolean): T[] {
  let n = cells.length;
  while (n > 0 && empty(cells[n - 1]!)) n -= 1;
  return cells.slice(0, n);
}

/**
 * Shapes a grid read like the values API it replaced: trailing empty cells and
 * rows are dropped (so a short page still ends paging), the formula column holds
 * the formula text or the entered value, and links are index-aligned.
 */
export function gridRows(grid: readonly (readonly GridCell[])[], options: Pick<ReadOptions, 'formulas' | 'links'>): RawRow[] {
  const blank = (c: GridCell) => (c.formattedValue ?? '') === '' && c.userEnteredValue?.formulaValue === undefined && !c.hyperlink;
  const rows = trimEnd(grid.map((cells) => trimEnd([...cells], blank)), (cells) => cells.length === 0);
  return rows.map((cells) => {
    const entered = (c: GridCell) => {
      const v = c.userEnteredValue;
      return v?.formulaValue ?? v?.stringValue ?? v?.numberValue ?? v?.boolValue ?? '';
    };
    return {
      values: cells.map((c) => c.formattedValue ?? ''),
      ...(options.formulas ? { formulas: cells.map(entered) } : {}),
      ...(options.links ? { links: cells.map((c) => c.hyperlink ?? null) } : {}),
    };
  });
}

export class GoogleSheetTransport implements SheetTransport {
  readonly mode = 'live' as const;

  constructor(
    private readonly spreadsheetId: string,
    private readonly tokens: ServiceAccountTokens,
    private readonly writeEnabled: boolean,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async auth(): Promise<string> {
    return this.tokens.token([this.writeEnabled ? SCOPES.sheetsWrite : SCOPES.sheetsRead]);
  }

  async readTab(tab: string, lastColumn: string, options: ReadOptions): Promise<RawRow[]> {
    const end = options.startRow + options.maxRows - 1;
    const range = `${quoteTab(tab)}!A${options.startRow}:${lastColumn}${end}`;
    // CS-052: one request per page. Formatted values, formulas and hyperlinks
    // all come from the same grid read, instead of three separate calls that
    // each counted against Google's per-minute read quota.
    const fields = 'sheets(data(rowData(values(formattedValue,userEnteredValue,hyperlink))))';
    const url = `${API}/${encodeURIComponent(this.spreadsheetId)}?ranges=${encodeURIComponent(range)}&fields=${encodeURIComponent(fields)}`;
    return withReadRetry(async () => {
      const token = await this.auth();
      const response = await this.fetchImpl(url, { headers: { authorization: `Bearer ${token}` } });
      if (!response.ok) throw googleError(response.status, 'sheet');
      const body = (await response.json()) as { sheets?: { data?: { rowData?: { values?: GridCell[] }[] }[] }[] };
      const grid = (body.sheets?.[0]?.data?.[0]?.rowData ?? []).map((r) => r.values ?? []);
      return gridRows(grid, options);
    });
  }

  async writeCells(tab: string, writes: CellWrite[]): Promise<void> {
    if (!this.writeEnabled) throw googleError(403, 'sheet');
    const token = await this.auth();
    const data = writes.map((w) => ({
      range: `${quoteTab(tab)}!${columnLetter(w.column)}${w.row}`,
      majorDimension: 'ROWS',
      values: [[w.value]],
    }));
    // Writes are not retried automatically: the repository re-reads and decides.
    const res = await this.fetchImpl(`${API}/${encodeURIComponent(this.spreadsheetId)}/values:batchUpdate`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ valueInputOption: 'RAW', data }),
    });
    if (!res.ok) throw googleError(res.status, 'sheet');
  }

  async appendRow(tab: string, lastColumn: string, values: readonly (string | boolean)[]): Promise<void> {
    if (!this.writeEnabled) throw googleError(403, 'sheet');
    const token = await this.auth();
    const range = `${quoteTab(tab)}!A:${lastColumn}`;
    const url =
      `${API}/${encodeURIComponent(this.spreadsheetId)}/values/${encodeURIComponent(range)}:append` +
      '?valueInputOption=RAW&insertDataOption=INSERT_ROWS';
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ majorDimension: 'ROWS', values: [[...values]] }),
    });
    if (!res.ok) throw googleError(res.status, 'sheet');
  }
}
