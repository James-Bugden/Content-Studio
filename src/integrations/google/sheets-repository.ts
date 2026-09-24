import 'server-only';
import type { Capability } from '@/domain/capability';
import { AppError, isAppError } from '@/domain/errors';
import { fingerprint } from '@/domain/hash';
import {
  cellText,
  patchAlreadyApplied,
  toLibraryRecord,
  toScheduleRecord,
  type LibraryPatch,
  type RawRow,
  type SchedulePatch,
} from '@/domain/mapping';
import { operationIdSchema, type MutationEnvelope, type MutationResult, type StepResult } from '@/domain/mutation';
import type { LibraryRecord, QueueSummaryRow, ScheduleRecord, WorkflowSettings } from '@/domain/records';
import {
  LIBRARY_HEADERS,
  LIBRARY_WRITABLE,
  SCHEDULE_HEADERS,
  SCHEDULE_WRITABLE,
  SHEET_TABS,
  discoverHeaders,
  type HeaderIndex,
  type LibraryField,
  type ScheduleField,
  type SheetTabKey,
} from '@/domain/sheet-schema';
import { parseQueueSummary, parseWorkflowSettings } from '@/domain/settings';
import { emit, targetHash, timed } from '@/observability/events';
import type { ContentRepository, SchemaStatus } from '@/application/ports';
import { MAX_TAB_ROWS, PAGE_ROWS, type CellWrite, type SheetTransport } from './sheet-transport';

/**
 * Sheet-backed ContentRepository (CS-003).
 *
 * - Columns are discovered by exact header name on every read (MAP-04), so a
 *   reordered tab still works and a renamed or missing column is SCHEMA_DRIFT.
 * - Writes touch only named cells in one row, never a formula cell, never the
 *   derived Ready Queue (READY-02), and only after re-reading the row and
 *   comparing its revision with the caller's expected revision (REV-02).
 * - Operation ids make retries safe: the same operation with the same patch
 *   replays; the same operation with a different patch is a conflict.
 *
 * Sheets has no conditional write, so a concurrent edit between our re-read and
 * our write can still be lost. The window is one API round trip; it is recorded
 * as a known atomicity limit (docs/implementation/atomicity.md).
 */

const MAX_CELL_CHARS = 50_000;
const OP_CACHE_MAX = 500;

type OpRecord = { patchHash: string; result: MutationResult<unknown> };

type TabRead<F extends string> = { index: HeaderIndex<F>; rows: { raw: RawRow; row: number }[] };

export class SheetsContentRepository implements ContentRepository {
  private readonly ops = new Map<string, OpRecord>();

  constructor(
    private readonly transport: SheetTransport,
    private readonly options: { writable: boolean; readCacheMs?: number } = { writable: true },
  ) {}

  /**
   * Read cache (live mode only). One page render asks for the same tab several
   * times; against the real Sheets API that is several slow round trips and extra
   * quota. Concurrent identical reads share one request, results live for a few
   * seconds, and every write reads fresh and clears the cache, so a write never
   * compares against a cached revision.
   */
  private readonly readCache = new Map<string, { at: number; rows: Promise<RawRow[]> }>();

  private cachedReadAll(tabKey: SheetTabKey, withExtras: boolean, fresh = false): Promise<RawRow[]> {
    const ttl = this.options.readCacheMs ?? 0;
    const key = `${tabKey}:${withExtras}`;
    const hit = this.readCache.get(key);
    if (!fresh && hit && Date.now() - hit.at <= ttl) return hit.rows;
    const rows = this.readAll(tabKey, withExtras);
    if (ttl > 0) {
      this.readCache.set(key, { at: Date.now(), rows });
      rows.catch(() => this.readCache.delete(key));
    }
    return rows;
  }

  capability(): Capability {
    return { provider: 'sheet', mode: this.transport.mode, state: this.options.writable ? 'ready' : 'read_only' };
  }

  // ------------------------------------------------------------------ reads

  private async readAll(tabKey: SheetTabKey, withExtras: boolean): Promise<RawRow[]> {
    const tab = SHEET_TABS[tabKey];
    const rows: RawRow[] = [];
    let start = 1;
    for (;;) {
      let page: RawRow[];
      try {
        page = await timed(
          { name: 'sheet.read', adapter: 'sheet', facts: { tab: tabKey, startRow: start } },
          () => this.transport.readTab(tab.name, tab.lastColumn, { startRow: start, maxRows: PAGE_ROWS, formulas: withExtras, links: withExtras }),
        );
      } catch (error) {
        // A prior page already returned exactly PAGE_ROWS rows, so this request is shaped
        // exactly like every earlier one. Sheets answers a range that starts past the tab's
        // actual grid size with 400 "Unable to parse range", which the transport reports as
        // VALIDATION_FAILED: that is the grid boundary, not bad input, so the previous page
        // was the last one and reading stops here.
        if (start > 1 && isAppError(error) && error.code === 'VALIDATION_FAILED') break;
        throw error;
      }
      rows.push(...page);
      if (page.length < PAGE_ROWS) break;
      start += PAGE_ROWS;
      if (start > MAX_TAB_ROWS) throw new AppError('VALIDATION_FAILED', { reason: 'tab_too_large', tab: tabKey });
    }
    return rows;
  }

  private async readTab<F extends string>(tabKey: 'library' | 'queue' | 'readyQueue' | 'schedule', headers: Record<F, string>, fresh = false): Promise<TabRead<F>> {
    const tab = SHEET_TABS[tabKey];
    const all = await this.cachedReadAll(tabKey, true, fresh);
    const headerRow = all[tab.headerRow - 1];
    const found = discoverHeaders(headers, headerRow?.values ?? []);
    if (!found.ok) {
      emit({ name: 'sheet.schema_drift', adapter: 'sheet', outcome: 'error', code: 'SCHEMA_DRIFT', facts: { tab: tabKey, problems: found.problems.length } });
      throw new AppError('SCHEMA_DRIFT', { tab: tabKey, problems: found.problems });
    }
    const rows: { raw: RawRow; row: number }[] = [];
    all.forEach((raw, i) => {
      const row = i + 1;
      if (row <= tab.headerRow) return;
      if (raw.values.every((v) => cellText(v).trim() === '')) return;
      rows.push({ raw, row });
    });
    return { index: found.index, rows };
  }

  async schema(): Promise<SchemaStatus> {
    const tabs: SchemaStatus['tabs'] = [];
    const check = async <F extends string>(tabKey: 'library' | 'queue' | 'readyQueue' | 'schedule', headers: Record<F, string>) => {
      const tab = SHEET_TABS[tabKey];
      try {
        const rows = await this.transport.readTab(tab.name, tab.lastColumn, { startRow: tab.headerRow, maxRows: 1, formulas: false, links: false });
        const found = discoverHeaders(headers, rows[0]?.values ?? []);
        tabs.push(
          found.ok
            ? { tab: tab.name, ok: true, problems: [], passthrough: found.index.passthrough.map((p) => p.header) }
            : { tab: tab.name, ok: false, problems: found.problems, passthrough: [] },
        );
      } catch (error) {
        tabs.push({ tab: tab.name, ok: false, problems: [{ kind: 'missing', header: isAppError(error) ? error.code : 'UNKNOWN' }], passthrough: [] });
      }
    };
    await check('library', LIBRARY_HEADERS);
    await check('queue', LIBRARY_HEADERS);
    await check('readyQueue', LIBRARY_HEADERS);
    await check('schedule', SCHEDULE_HEADERS);
    return { ok: tabs.every((t) => t.ok), tabs };
  }

  async listLibrary(): Promise<LibraryRecord[]> {
    const { index, rows } = await this.readTab('library', LIBRARY_HEADERS);
    return rows.map(({ raw, row }) => toLibraryRecord(index, raw, row));
  }

  async getLibrary(libraryId: string): Promise<LibraryRecord> {
    const all = await this.listLibrary();
    return uniqueBy(all, (r) => r.value.libraryId, libraryId);
  }

  async listQueue(): Promise<LibraryRecord[]> {
    const { index, rows } = await this.readTab('queue', LIBRARY_HEADERS);
    return rows.map(({ raw, row }) => toLibraryRecord(index, raw, row));
  }

  async getQueue(libraryId: string): Promise<LibraryRecord> {
    const all = await this.listQueue();
    return uniqueBy(all, (r) => r.value.libraryId, libraryId);
  }

  async listReadyQueue(): Promise<LibraryRecord[]> {
    const { index, rows } = await this.readTab('readyQueue', LIBRARY_HEADERS);
    return rows.map(({ raw, row }) => toLibraryRecord(index, raw, row));
  }

  async listSchedule(): Promise<ScheduleRecord[]> {
    const { index, rows } = await this.readTab('schedule', SCHEDULE_HEADERS);
    return rows.map(({ raw, row }) => toScheduleRecord(index, raw, row));
  }

  async getSchedule(contentId: string): Promise<ScheduleRecord> {
    const all = await this.listSchedule();
    return uniqueBy(all, (r) => r.value.contentId, contentId);
  }

  async queueSummary(): Promise<QueueSummaryRow[]> {
    return parseQueueSummary(await this.cachedReadAll('queueSummary', true));
  }

  async workflowSettings(): Promise<WorkflowSettings> {
    const rows = await this.cachedReadAll('settings', false);
    return parseWorkflowSettings(rows.map((r) => r.values));
  }

  // ------------------------------------------------------------------ writes

  async updateLibrary(m: MutationEnvelope<{ libraryId: string }, LibraryPatch>): Promise<MutationResult<LibraryRecord>> {
    return this.update('library', LIBRARY_HEADERS, LIBRARY_WRITABLE, m.target.libraryId, (r) => r.value.libraryId, m, toLibraryRecord);
  }

  async updateQueue(m: MutationEnvelope<{ libraryId: string }, LibraryPatch>): Promise<MutationResult<LibraryRecord>> {
    return this.update('queue', LIBRARY_HEADERS, LIBRARY_WRITABLE, m.target.libraryId, (r) => r.value.libraryId, m, toLibraryRecord);
  }

  async updateSchedule(m: MutationEnvelope<{ contentId: string }, SchedulePatch>): Promise<MutationResult<ScheduleRecord>> {
    return this.update('schedule', SCHEDULE_HEADERS, SCHEDULE_WRITABLE, m.target.contentId, (r) => r.value.contentId, m, toScheduleRecord);
  }

  private async update<F extends string, R extends { row: number; revision: string; cells: Record<F, string>; formulaFields: F[] }>(
    tabKey: 'library' | 'queue' | 'schedule',
    headers: Record<F, string>,
    writable: readonly F[],
    id: string,
    idOf: (r: R) => string,
    m: MutationEnvelope<unknown, Partial<Record<F, string>>>,
    toRecord: (index: HeaderIndex<F>, raw: RawRow, row: number) => R,
  ): Promise<MutationResult<R>> {
    const opId = m.operationId;
    const steps: StepResult[] = [];
    const fail = (code: AppError['code'], details?: Record<string, unknown>): MutationResult<R> => {
      emit({ name: `sheet.update.${tabKey}`, adapter: 'sheet', outcome: code === 'CONFLICT' || code === 'STALE_READ' ? 'conflict' : 'error', operationId: opId, targetHash: targetHash(id), code });
      return { ok: false, operationId: opId, code, steps: [...steps, { step: `write ${tabKey} row`, provider: 'sheet', status: 'failed', errorCode: code }], ...(details ? { details } : {}) };
    };

    // Validation (SEC-03): actor, operation id, fields and value sizes.
    if (m.actor.role !== 'owner') return fail('FORBIDDEN');
    if (!operationIdSchema.safeParse(opId).success) return fail('VALIDATION_FAILED', { reason: 'operation_id' });
    if (!this.options.writable) return fail('CONFIG_MISSING', { reason: 'write_disabled' });
    const entries = Object.entries(m.patch) as [F, string][];
    if (entries.length === 0) return fail('VALIDATION_FAILED', { reason: 'empty_patch' });
    for (const [field, value] of entries) {
      if (!writable.includes(field)) return fail('VALIDATION_FAILED', { reason: 'field_not_writable', field });
      if (typeof value !== 'string' || value.length > MAX_CELL_CHARS) return fail('VALIDATION_FAILED', { reason: 'value_invalid', field });
    }

    // Idempotency.
    const patchHash = fingerprint(JSON.stringify([tabKey, id, entries.sort(([a], [b]) => a.localeCompare(b))]));
    const prior = this.ops.get(opId);
    if (prior) {
      if (prior.patchHash !== patchHash) return fail('CONFLICT', { reason: 'operation_reused_with_different_patch' });
      if (prior.result.ok) return { ...(prior.result as MutationResult<R> & { ok: true }), replayed: true };
    }

    // Re-read and compare.
    let read: TabRead<F>;
    try {
      read = await this.readTab(tabKey, headers, true);
    } catch (error) {
      return fail(isAppError(error) ? error.code : 'PROVIDER_UNAVAILABLE');
    }
    const matches = read.rows.map(({ raw, row }) => toRecord(read.index, raw, row)).filter((r) => idOf(r) === id);
    if (matches.length === 0) return fail('NOT_FOUND');
    if (matches.length > 1) return fail('CONFLICT', { reason: 'duplicate_id' });
    const current = matches[0]!;

    if (current.revision !== m.expectedRevision) {
      if (patchAlreadyApplied(current.cells, m.patch)) {
        // Lost response: our own earlier write already landed. Report it truthfully.
        const result: MutationResult<R> = {
          ok: true,
          operationId: opId,
          replayed: true,
          value: current,
          steps: [{ step: `write ${tabKey} row`, provider: 'sheet', status: 'skipped_already_applied', revision: current.revision }],
        };
        this.remember(opId, patchHash, result);
        emit({ name: `sheet.update.${tabKey}`, adapter: 'sheet', outcome: 'replayed', operationId: opId, targetHash: targetHash(id) });
        return result;
      }
      return fail('STALE_READ', { currentRevision: current.revision, expectedRevision: m.expectedRevision });
    }

    const formulaHit = entries.find(([field]) => current.formulaFields.includes(field));
    if (formulaHit) return fail('VALIDATION_FAILED', { reason: 'formula_cell', field: formulaHit[0] });

    const changed = entries.filter(([field, value]) => current.cells[field] !== value);
    if (changed.length > 0) {
      const writes: CellWrite[] = changed.map(([field, value]) => ({
        row: current.row,
        column: read.index.columns[field],
        value: isCheckboxField(field) ? value === 'TRUE' : value,
      }));
      try {
        await timed(
          { name: `sheet.write.${tabKey}`, adapter: 'sheet', operationId: opId, targetHash: targetHash(id), facts: { cells: writes.length } },
          () => this.transport.writeCells(SHEET_TABS[tabKey].name, writes),
        );
      } catch (error) {
        return fail(isAppError(error) ? error.code : 'PROVIDER_UNAVAILABLE');
      } finally {
        // A write (even a failed or uncertain one) may have changed the Sheet.
        this.readCache.clear();
      }
    }

    // Read back so the caller gets the authoritative new revision.
    let after: R;
    try {
      const again = await this.readTab(tabKey, headers, true);
      const found = again.rows.map(({ raw, row }) => toRecord(again.index, raw, row)).filter((r) => idOf(r) === id);
      if (found.length !== 1) {
        // The write landed; only the confirmation failed. Report exactly that (review finding 5).
        return {
          ok: false,
          operationId: opId,
          code: 'PARTIAL_FAILURE',
          steps: [
            { step: `write ${tabKey} row`, provider: 'sheet', status: 'done' },
            { step: 'confirm new revision', provider: 'sheet', status: 'failed', errorCode: 'CONFLICT' },
          ],
          details: { reason: 'row_moved_after_write' },
        };
      }
      after = found[0]!;
    } catch (error) {
      // The write happened but we cannot confirm the new revision.
      return {
        ok: false,
        operationId: opId,
        code: 'PARTIAL_FAILURE',
        steps: [
          { step: `write ${tabKey} row`, provider: 'sheet', status: 'done' },
          { step: 'confirm new revision', provider: 'sheet', status: 'failed', errorCode: isAppError(error) ? error.code : 'UNKNOWN' },
        ],
      };
    }
    const result: MutationResult<R> = {
      ok: true,
      operationId: opId,
      replayed: false,
      value: after,
      steps: [{ step: `write ${tabKey} row`, provider: 'sheet', status: changed.length ? 'done' : 'skipped_already_applied', revision: after.revision }],
    };
    this.remember(opId, patchHash, result);
    emit({ name: `sheet.update.${tabKey}`, adapter: 'sheet', outcome: 'ok', operationId: opId, targetHash: targetHash(id), facts: { cells: changed.length } });
    return result;
  }

  private remember(opId: string, patchHash: string, result: MutationResult<unknown>): void {
    this.ops.set(opId, { patchHash, result });
    if (this.ops.size > OP_CACHE_MAX) this.ops.delete(this.ops.keys().next().value!);
  }
}

function isCheckboxField(field: string): boolean {
  return field === 'queueForSchedule' || field === 'posted';
}

function uniqueBy<R>(all: R[], idOf: (r: R) => string, id: string): R {
  const found = all.filter((r) => idOf(r) === id);
  if (found.length === 0) throw new AppError('NOT_FOUND');
  if (found.length > 1) throw new AppError('CONFLICT', { reason: 'duplicate_id' });
  return found[0]!;
}

export type { LibraryField, ScheduleField };
