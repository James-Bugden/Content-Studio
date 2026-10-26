import { FakeSheetTransport } from '@/integrations/google/fake-sheet';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';
import { LIBRARY_HEADERS, SCHEDULE_HEADERS, SHEET_TABS } from '@/domain/sheet-schema';

export const scoreKinds = ['library', 'queue', 'schedule'] as const;
export type ScoreKind = typeof scoreKinds[number];
export const scoreMethod = (kind: ScoreKind) => kind === 'library' ? 'listLibrary' : kind === 'queue' ? 'listQueue' : 'listSchedule';
export const acceptedScores = ['6', '6.0', '6.5', '7.50', '0', '-6.25', '-0.00', '999.99', '-999.99', '0006.50', ' 6.5 ', '6.5\u00a0', '6.5\t'];
export const refusedScores = ['6.', '.5', '1e3', '6e1', '6,5', '\uFF16.\uFF15', '\u0666.\u0665', '-', '+6', '6.555', '1000', '-1000', '9'.repeat(80), 'NaN', 'Infinity', 'x6.5', '6.5x', '6.5\n7', '6.5 Cafe\u0301'];
export function scoreFixture(text: string, kind: ScoreKind = 'library') {
  const sheet = new FakeSheetTransport(), tab = SHEET_TABS[kind].name;
  const grid = sheet.rawTab(tab), header = kind === 'schedule' ? 1 : 0, row = header + 2;
  const column = grid[header]!.findIndex(c => c.value === LIBRARY_HEADERS.hookScore);
  sheet.externalEdit(tab, row, column, text);
  // Exact decomposed copy and a terminal tab must survive beside the score.
  const copy = grid[header]!.findIndex(c => c.value === (kind === 'schedule' ? SCHEDULE_HEADERS.content : LIBRARY_HEADERS.draftContent));
  sheet.externalEdit(tab, row, copy, 'Synthetic Cafe\u0301\t');
  if (kind === 'schedule') {
    // These independent score fixtures do not exercise schedule lineage.
    const parent = grid[header]!.findIndex(c => c.value === SCHEDULE_HEADERS.parentContentId);
    for (let i = header + 2; i <= grid.length; i++) sheet.externalEdit(tab, i, parent, '');
  }
  if (kind !== 'schedule') {
    const angle = grid[header]!.findIndex(c => c.value === LIBRARY_HEADERS.contentAngle);
    sheet.externalEdit(tab, row, angle, '7. Cafe\u0301\t');
  }
  grid[header]!.push({ value: 'Synthetic extra' });
  grid[row - 1]!.push({ value: 'Synthetic Cafe\u0301\t' });
  return { sheet, repo: new SheetsContentRepository(sheet), tab, grid, column, row };
}
