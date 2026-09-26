import 'server-only';
import type { RawRow } from '@/domain/mapping';
import { columnLetter } from '@/domain/sheet-schema';
import { SCOPES, googleError, withReadRetry, type ServiceAccountTokens } from './service-account';
import type { CellWrite, ReadOptions, SheetTransport } from './sheet-transport';

/**
 * Google Sheets REST transport (CS-003). Reads formatted values plus formulas and
 * hyperlinks for the bounded range; writes named cells with RAW input so a value
 * that starts with `=` is stored as text, never evaluated (formula injection).
 */
const API = 'https://sheets.googleapis.com/v4/spreadsheets';

function quoteTab(tab: string): string {
  return `'${tab.replace(/'/g, "''")}'`;
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
    return withReadRetry(async () => {
      const token = await this.auth();
      const headers = { authorization: `Bearer ${token}` };
      const base = `${API}/${encodeURIComponent(this.spreadsheetId)}/values/${encodeURIComponent(range)}`;
      // These representations describe the same range and have no dependency
      // on one another. Fetch them concurrently to avoid three network latencies
      // for every page of the large Content Library.
      const linkUrl = `${API}/${encodeURIComponent(this.spreadsheetId)}?ranges=${encodeURIComponent(range)}&fields=${encodeURIComponent('sheets(data(rowData(values(hyperlink))))')}`;
      const [valuesRes, formulaRes, linkRes] = await Promise.all([
        this.fetchImpl(`${base}?valueRenderOption=FORMATTED_VALUE&majorDimension=ROWS`, { headers }),
        options.formulas ? this.fetchImpl(`${base}?valueRenderOption=FORMULA&majorDimension=ROWS`, { headers }) : Promise.resolve(null),
        options.links ? this.fetchImpl(linkUrl, { headers }) : Promise.resolve(null),
      ]);
      for (const response of [valuesRes, formulaRes, linkRes]) {
        if (response && !response.ok) throw googleError(response.status, 'sheet');
      }
      const values = ((await valuesRes.json()) as { values?: unknown[][] }).values ?? [];
      const formulas = formulaRes ? ((await formulaRes.json()) as { values?: unknown[][] }).values ?? [] : [];
      const linkBody = linkRes ? (await linkRes.json()) as { sheets?: { data?: { rowData?: { values?: { hyperlink?: string }[] }[] }[] }[] } : null;
      const links: (string | null)[][] = (linkBody?.sheets?.[0]?.data?.[0]?.rowData ?? []).map((r) => (r.values ?? []).map((v) => v.hyperlink ?? null));

      return values.map((row, i) => ({
        values: row,
        ...(options.formulas ? { formulas: formulas[i] ?? [] } : {}),
        ...(options.links ? { links: links[i] ?? [] } : {}),
      }));
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
