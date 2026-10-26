import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError, ERROR_CODES } from '@/domain/errors';
import { SHEET_TABS } from '@/domain/sheet-schema';
import { FakeSheetTransport } from '@/integrations/google/fake-sheet';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';
import { PAGE_ROWS } from '@/integrations/google/sheet-transport';
import { setTelemetrySink, type TelemetryEvent } from '@/observability/events';
import { buildSheetMirrorSnapshot } from '@/application/sheet-mirror';
import { ContentParityJournal, shadowContentRepository } from '@/application/content-parity';

afterEach(() => { setTelemetrySink(null); vi.restoreAllMocks(); });

function missingSummary() {
  const transport = new FakeSheetTransport();
  const read = transport.readTab.bind(transport);
  const spy = vi.spyOn(transport, 'readTab').mockImplementation(async (tab, column, options) => {
    if (tab === SHEET_TABS.queueSummary.name) throw new AppError('VALIDATION_FAILED', { provider: 'sheet', status: 400 });
    return read(tab, column, options);
  });
  return { repo: new SheetsContentRepository(transport), spy };
}

describe('CS-068: optional Content Queue Summary tab', () => {
  it('returns empty on first-page 400 and records a structured absence fact', async () => {
    const events: TelemetryEvent[] = [];
    setTelemetrySink(event => events.push(event));
    const { repo, spy } = missingSummary();
    await expect(repo.queueSummary()).resolves.toEqual([]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[2].startRow).toBe(1);
    expect(events).toContainEqual(expect.objectContaining({
      name: 'sheet.tab_absent', adapter: 'sheet', outcome: 'ok',
      facts: { tab: 'queueSummary', tabAbsent: true, startRow: 1 },
    }));
  });

  it.each(['listLibrary', 'listQueue', 'listReadyQueue', 'listSchedule', 'workflowSettings'] as const)(
    'still rejects a first-page 400 for %s', async method => {
      const transport = new FakeSheetTransport();
      transport.failNext({ op: 'read', code: 'VALIDATION_FAILED' });
      await expect(new SheetsContentRepository(transport)[method]()).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    },
  );

  it.each(ERROR_CODES.filter(code => code !== 'VALIDATION_FAILED'))('does not swallow %s for the summary', async code => {
    const transport = new FakeSheetTransport();
    transport.failNext({ op: 'read', code });
    await expect(new SheetsContentRepository(transport).queueSummary()).rejects.toMatchObject({ code });
  });

  it('does not swallow an untyped error', async () => {
    const transport = new FakeSheetTransport();
    const error = new Error('Synthetic failure');
    vi.spyOn(transport, 'readTab').mockRejectedValue(error);
    await expect(new SheetsContentRepository(transport).queueSummary()).rejects.toBe(error);
  });

  it.each([
    { kind: 'a plain object', error: { code: 'VALIDATION_FAILED', details: { status: 400 } } },
    { kind: 'an ordinary Error', error: Object.assign(new Error('Synthetic failure'), { code: 'VALIDATION_FAILED' }) },
  ])('does not swallow $kind carrying VALIDATION_FAILED on the first summary page', async ({ error }) => {
    const transport = new FakeSheetTransport();
    const spy = vi.spyOn(transport, 'readTab').mockRejectedValueOnce(error);
    await expect(new SheetsContentRepository(transport).queueSummary()).rejects.toBe(error);
    expect(spy).toHaveBeenCalledExactlyOnceWith(
      SHEET_TABS.queueSummary.name, SHEET_TABS.queueSummary.lastColumn, expect.objectContaining({ startRow: 1 }),
    );
  });

  it('preserves present summary rows when a later page reaches the grid boundary', async () => {
    const events: TelemetryEvent[] = [];
    setTelemetrySink(event => events.push(event));
    const transport = new FakeSheetTransport();
    const rows = [{ values: ['Content Source', 'Total'] },
      ...Array.from({ length: PAGE_ROWS - 1 }, (_, i) => ({ values: [`Synthetic source ${i}`, '12'] }))];
    const spy = vi.spyOn(transport, 'readTab').mockImplementation(async (_tab, _column, options) => {
      if (options.startRow > 1) throw new AppError('VALIDATION_FAILED', { status: 400 });
      return rows;
    });
    const summary = await new SheetsContentRepository(transport).queueSummary();
    expect(summary).toHaveLength(PAGE_ROWS - 1);
    expect(summary[0]).toMatchObject({ source: 'Synthetic source 0', counts: { Total: 12 } });
    expect(spy.mock.calls.map(call => call[2].startRow)).toEqual([1, PAGE_ROWS + 1]);
    expect(events.some(event => event.name === 'sheet.tab_absent')).toBe(false);
  });

  it('builds a complete mirror snapshot with an empty summary', async () => {
    const { repo } = missingSummary();
    const snapshot = await buildSheetMirrorSnapshot(repo, { sourceKey: 'synthetic_workbook' });
    expect(snapshot.counts.queue_summary).toBe(0);
    expect(snapshot.rows.filter(row => row.collection === 'queue_summary')).toEqual([]);
    expect(snapshot.counts.library).toBeGreaterThan(0);
    expect(snapshot.counts.schedule).toBeGreaterThan(0);
    expect(snapshot.counts.workflow_settings).toBe(1);
    expect(snapshot.rows.find(row => row.collection === 'schema')?.payload).toMatchObject({ ok: true });
  });

  it('samples parity as equal for empty summaries on both sides', async () => {
    const { repo } = missingSummary();
    const db = new SheetsContentRepository(new FakeSheetTransport({ [SHEET_TABS.queueSummary.name]: [] }));
    const journal = new ContentParityJournal();
    journal.imported(Date.now());
    await expect(shadowContentRepository(repo, db, journal, () => true).queueSummary()).resolves.toEqual([]);
    expect(journal.samples).toEqual([expect.objectContaining({ collection: 'queue_summary', idsEqual: true, fields: 0, equal: 0, blocking: 0, facts: [] })]);
    expect(journal.summary().collections.find(row => row.collection === 'queue_summary')).toMatchObject({ idsEqual: true, fieldEquality: 100, fieldsNA: true, blocking: 0 });
  });
});
