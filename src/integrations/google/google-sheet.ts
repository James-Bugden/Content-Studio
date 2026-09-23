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
      const valuesRes = await this.fetchImpl(`${base}?valueRenderOption=FORMATTED_VALUE&majorDimension=ROWS`, { headers });
      if (!valuesRes.ok) throw googleError(valuesRes.status, 'sheet');
      const values = ((await valuesRes.json()) as { values?: unknown[][] }).values ?? [];

      let formulas: unknown[][] = [];
      if (options.formulas) {
        const fRes = await this.fetchImpl(`${base}?valueRenderOption=FORMULA&majorDimension=ROWS`, { headers });
        if (!fRes.ok) throw googleError(fRes.status, 'sheet');
        formulas = ((await fRes.json()) as { values?: unknown[][] }).values ?? [];
      }

      let links: (string | null)[][] = [];
      if (options.links) {
        const url = `${API}/${encodeURIComponent(this.spreadsheetId)}?ranges=${encodeURIComponent(range)}&fields=${encodeURIComponent('sheets(data(rowData(values(hyperlink))))')}`;
        const lRes = await this.fetchImpl(url, { headers });
        if (!lRes.ok) throw googleError(lRes.status, 'sheet');
        const body = (await lRes.json()) as { sheets?: { data?: { rowData?: { values?: { hyperlink?: string }[] }[] }[] }[] };
        links = (body.sheets?.[0]?.data?.[0]?.rowData ?? []).map((r) => (r.values ?? []).map((v) => v.hyperlink ?? null));
      }

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
}
