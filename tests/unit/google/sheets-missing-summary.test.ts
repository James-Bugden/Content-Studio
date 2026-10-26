import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError, ERROR_CODES } from '@/domain/errors';
import { SHEET_TABS } from '@/domain/sheet-schema';
import { FakeSheetTransport } from '@/integrations/google/fake-sheet';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';
import { PAGE_ROWS } from '@/integrations/google/sheet-transport';
import { setTelemetrySink, type TelemetryEvent } from '@/observability/events';
import { buildSheetMirrorSnapshot } from '@/application/sheet-mirror';
import { ContentParityJournal, shadowContentRepository } from '@/application/content-parity';
import { deriveQueueSummary } from '@/application/queue-summary';
import { SupabaseContentRepository } from '@/integrations/supabase/content-repository';
import { FakeContentDb } from '@/integrations/supabase/fake-content-db';

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
  it('derives counts on first-page 400 and records a structured absence fact', async () => {
    const events: TelemetryEvent[] = [];
    setTelemetrySink(event => events.push(event));
    const { repo, spy } = missingSummary();
    await expect(repo.queueSummary()).resolves.toEqual(deriveQueueSummary(await repo.listQueue()));
    expect(spy.mock.calls.filter(call => call[0] === SHEET_TABS.queueSummary.name)).toHaveLength(1);
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

  it('builds a complete mirror snapshot with the derived summary', async () => {
    const { repo } = missingSummary();
    const snapshot = await buildSheetMirrorSnapshot(repo, { sourceKey: 'synthetic_workbook' });
    const summary = deriveQueueSummary(await repo.listQueue());
    expect(snapshot.counts.queue_summary).toBe(summary.length);
    expect(snapshot.rows.filter(row => row.collection === 'queue_summary').map(row => row.payload)).toEqual(summary);
    expect(snapshot.counts.library).toBeGreaterThan(0);
    expect(snapshot.counts.schedule).toBeGreaterThan(0);
    expect(snapshot.counts.workflow_settings).toBe(1);
    expect(snapshot.rows.find(row => row.collection === 'schema')?.payload).toMatchObject({ ok: true });
  });

  it('samples derived summary parity through the DB reader', async () => {
    const { repo } = missingSummary();
    const db = new SupabaseContentRepository(new FakeContentDb());
    const journal = new ContentParityJournal();
    journal.imported(Date.now());
    await expect(shadowContentRepository(repo, db, journal, () => true).queueSummary()).resolves.toEqual(await db.queueSummary());
    expect(journal.samples).toEqual([expect.objectContaining({ collection: 'queue_summary', idsEqual: true, blocking: 0, facts: [] })]);
    expect(journal.summary().collections.find(row => row.collection === 'queue_summary')).toMatchObject({ idsEqual: true, fieldEquality: 100, fieldsNA: false, blocking: 0 });
  });

  it('keeps a present empty/malformed tab empty and propagates queue read failures only for absence', async () => {
    for (const rows of [[], [{ values: ['Unrecognised synthetic header'] }]]) {
      const transport = new FakeSheetTransport({ [SHEET_TABS.queueSummary.name]: rows });
      const repo = new SheetsContentRepository(transport), readQueue = vi.spyOn(repo, 'listQueue').mockRejectedValue(new Error('Synthetic unavailable'));
      await expect(repo.queueSummary()).resolves.toEqual([]);
      expect(readQueue).not.toHaveBeenCalled();
    }
    const { repo } = missingSummary();
    vi.spyOn(repo, 'listQueue').mockRejectedValue(new AppError('PROVIDER_UNAVAILABLE'));
    await expect(repo.queueSummary()).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });

  it('tracks absence with its cached snapshot and rechecks presence after expiry', async () => {
    vi.useFakeTimers();
    try {
      const transport = new FakeSheetTransport(), read = transport.readTab.bind(transport);
      let absent = true;
      vi.spyOn(transport, 'readTab').mockImplementation((tab, column, options) => {
        if (tab === SHEET_TABS.queueSummary.name && absent) throw new AppError('VALIDATION_FAILED');
        return read(tab, column, options);
      });
      const repo = new SheetsContentRepository(transport, { writable: false, readCacheMs: 100 });
      const derived = await repo.queueSummary();
      expect(derived.length).toBeGreaterThan(0);
      absent = false;
      transport.rawTab(SHEET_TABS.queueSummary.name).splice(0);
      expect(await repo.queueSummary()).toEqual(derived);
      vi.advanceTimersByTime(101);
      expect(await repo.queueSummary()).toEqual([]);
      absent = true;
      vi.advanceTimersByTime(101);
      expect(await repo.queueSummary()).toEqual(derived);
    } finally { vi.useRealTimers(); }
  });
});
