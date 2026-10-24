import 'server-only';
import type { ContentDb } from './content-db';
import type { ContentRepository } from './ports';
import { canonicalJson, mirrorHash } from './sheet-mirror';
import { SupabaseContentRepository } from '@/integrations/supabase/content-repository';
import type { SheetTransport, CellWrite } from '@/integrations/google/sheet-transport';
import { MAX_TAB_ROWS } from '@/integrations/google/sheet-transport';
import { LIBRARY_HEADERS, SCHEDULE_HEADERS, SHEET_TABS } from '@/domain/sheet-schema';
import { cellText, rowRevision, type RawRow } from '@/domain/mapping';
import { fingerprintValues } from '@/domain/hash';
import { AppError } from '@/domain/errors';
import { operationIdSchema, type Actor } from '@/domain/mutation';

export type ExportKind = 'library' | 'queue' | 'schedule' | 'workflow_settings';
export type ExportCell = { value: string; formula?: string; link?: string };
export type ExportRow = { kind: ExportKind; id: string; version: string; importedRevision: string | null; cells: Record<string, ExportCell> };
export type ExportCheckpoint = { fingerprint: string; cells: Record<string, ExportCell>; version: string; at: number };
export type ExportIssue = { kind: ExportKind; id: string; fields: string[]; since: number; reason: 'export_mismatch' | 'export_lag' };
export type ExportParity = { at: number; exact: boolean; counts: Record<ExportKind, number>; dbHash: string; sheetHash: string; differences: ExportIssue[] };

/** Private durable implementation required before live wiring. Checkpoints must
 * survive restarts; storing a DB version alone cannot detect Sheet hand edits. */
export interface ContentExportJournal {
  checkpoints: Map<string, ExportCheckpoint>;
  issues: Map<string, ExportIssue>;
  reports: ExportParity[];
  decisions?: Map<string, { hash: string; actorHash: string; kind: ExportKind; fields: string[]; direction: 'export_db'; at: number }>;
}
export const exportKey = (kind: ExportKind, id: string) => `${kind}\0${id}`;
const revision = (raw: RawRow, width: number) => fingerprintValues([rowRevision(raw.values, width), rowRevision(raw.formulas ?? raw.values, width)]);
const rawCell = (raw: RawRow, column: number): ExportCell => {
  const formula = cellText(raw.formulas?.[column]);
  const link = raw.links?.[column] || (/^=HYPERLINK\(\s*"([^"]+)"/i.exec(formula)?.[1]);
  return { value: cellText(raw.values[column]), ...(formula.startsWith('=') ? { formula } : {}), ...(link ? { link } : {}) };
};
const different = (a: Record<string, ExportCell>, b: Record<string, ExportCell>) => [...new Set([...Object.keys(a), ...Object.keys(b)])]
  .filter(k => canonicalJson(a[k] ?? { value: '' }) !== canonicalJson(b[k] ?? { value: '' })).sort();

/** Uses the actual adapter renderers, including every Typefully stamp/metric. */
export async function contentExportRows(db: ContentDb): Promise<ExportRow[]> {
  const repo = new SupabaseContentRepository(db);
  const [posts, queue, schedule, settings, rawPosts, rawQueue, rawSchedule] = await Promise.all([
    repo.listLibrary(), repo.listQueue(), repo.listSchedule(), db.workflowSettings(), db.listPosts('library'), db.listPosts('queue'), db.listSchedule(),
  ]);
  const rows: ExportRow[] = [];
  for (const [kind, records, raw] of [['library', posts, rawPosts], ['queue', queue, rawQueue], ['schedule', schedule, rawSchedule]] as const) {
    for (const record of records) {
      const id = 'libraryId' in record.cells ? record.cells.libraryId : record.cells.contentId;
      const source = raw.find(r => ('library_id' in r ? r.library_id : r.content_id) === id)!;
      const headers: Record<string, string> = kind === 'schedule' ? SCHEDULE_HEADERS : LIBRARY_HEADERS;
      const cells = Object.fromEntries(Object.entries(record.cells).map(([field, value]) => [headers[field]!, {
        value, ...((record.links as Record<string, string>)[field] ? { link: (record.links as Record<string, string>)[field] } : {}),
      }]));
      for (const item of Object.values(record.passthrough ?? {})) {
        const p = item as { header: string; value: string; formula?: string; link?: string };
        if (typeof p.header !== 'string' || p.header in cells) throw new AppError('SCHEMA_DRIFT');
        cells[p.header] = { value: p.value, ...(p.formula?.startsWith('=') ? { formula: p.formula } : {}), ...(p.link ? { link: p.link } : {}) };
      }
      rows.push({ kind, id, version: String(source.row_version), importedRevision: source.sheet_revision, cells });
    }
  }
  rows.push(...settings.map(r => ({ kind: 'workflow_settings' as const, id: r.setting, version: String(r.row_version ?? 1), importedRevision: null,
    cells: { Setting: { value: r.setting }, Value: { value: r.value }, Notes: { value: r.notes } } })));
  rows.sort((a, b) => exportKey(a.kind, a.id).localeCompare(exportKey(b.kind, b.id), 'en'));
  if (new Set(rows.map(r => exportKey(r.kind, r.id))).size !== rows.length) throw new AppError('SCHEMA_DRIFT');
  return rows;
}

/** Only fake transport is enabled in DB-6. No Google/DB live client is wired. */
export class ContentExporter {
  private tail: Promise<unknown> = Promise.resolve();
  private readonly pending = new Map<string, number>();
  readonly lagSamples: { at: number; lagMs: number }[] = [];
  readonly repairedFailures: { since: number; repairedAt: number }[] = [];
  constructor(readonly db: ContentDb, private readonly sheet: SheetTransport, readonly journal: ContentExportJournal,
    private readonly now = Date.now) {
    if (db.mode !== 'fake' || sheet.mode !== 'fake') throw new AppError('FORBIDDEN', { reason: 'live_cutover_gates_pending' });
  }
  private async tab(kind: ExportKind) {
    const spec = kind === 'workflow_settings' ? SHEET_TABS.settings : SHEET_TABS[kind];
    // ZZ includes unknown columns; refuse a truncated tab, never infer absence.
    const rows = await this.sheet.readTab(spec.name, 'ZZ', { startRow: 1, maxRows: MAX_TAB_ROWS, formulas: true, links: true });
    if (rows.length >= MAX_TAB_ROWS) throw new AppError('SCHEMA_DRIFT', { reason: 'export_read_bound' });
    const idHeader = kind === 'workflow_settings' ? 'Setting' : kind === 'schedule' ? 'Content ID' : 'Library ID';
    const headerIndex = rows.findIndex(r => r.values.includes(idHeader));
    if (headerIndex < 0) throw new AppError('SCHEMA_DRIFT');
    const headers = rows[headerIndex]!.values.map(cellText);
    if (new Set(headers.filter(Boolean)).size !== headers.filter(Boolean).length) throw new AppError('SCHEMA_DRIFT');
    const data = rows.slice(headerIndex + 1).map((raw, i) => ({ raw, row: headerIndex + i + 2, id: cellText(raw.values[headers.indexOf(idHeader)]) })).filter(r => r.id);
    if (new Set(data.map(r => r.id)).size !== data.length) throw new AppError('SCHEMA_DRIFT');
    return { spec, headers, data };
  }
  private observed(raw: RawRow, headers: string[]) { return Object.fromEntries(headers.flatMap((h, i) => h ? [[h, rawCell(raw, i)]] : [])); }
  private issue(row: ExportRow, fields: string[], reason: ExportIssue['reason']) {
    const key = exportKey(row.kind, row.id), old = this.journal.issues.get(key);
    const issue: ExportIssue = { kind: row.kind, id: row.id, fields, since: old?.since ?? this.now(), reason };
    this.journal.issues.set(key, issue);
    return issue;
  }
  /** Single flight protects checkpoint+Sheet writes against overlapping repair/save. */
  run(): Promise<ExportParity> {
    const next = this.tail.then(() => this.execute());
    this.tail = next.catch(() => {});
    return next;
  }
  /** Explicit owner decision for the exceptional overwrite direction. The
   * preview's exact Sheet fingerprint AND DB version must still hold. This is
   * never called by repair. Copy-Sheet-into-DB uses an ordinary audited repo
   * patch with a new operation ID, then this explicit export authorization. */
  resolveMismatch(input: { actor: Actor; operationId: string; kind: ExportKind; id: string; expectedSheetFingerprint: string; expectedDbVersion: string }): Promise<ExportParity> {
    const next = this.tail.then(async () => {
      if (input.actor.role !== 'owner') throw new AppError('FORBIDDEN');
      if (!operationIdSchema.safeParse(input.operationId).success || !/^[0-9a-f]{16}$/.test(input.expectedSheetFingerprint)) throw new AppError('VALIDATION_FAILED');
      const hash = mirrorHash({ ...input, actor: input.actor.sub }), decisions = this.journal.decisions ??= new Map();
      const old = decisions.get(input.operationId);
      if (old) {
        if (old.hash !== hash) throw new AppError('CONFLICT', { reason: 'operation_reused_with_different_decision' });
        // Replays never grant a second overwrite if the Sheet changed again.
        return this.execute();
      }
      const wanted = (await contentExportRows(this.db)).find(r => r.kind === input.kind && r.id === input.id);
      const tab = await this.tab(input.kind), current = tab.data.find(r => r.id === input.id);
      if (!wanted || !current) throw new AppError('NOT_FOUND');
      if (wanted.version !== input.expectedDbVersion || revision(current.raw, tab.headers.length) !== input.expectedSheetFingerprint) throw new AppError('STALE_READ');
      const actual = this.observed(current.raw, tab.headers), key = exportKey(input.kind, input.id);
      decisions.set(input.operationId, { hash, actorHash: mirrorHash(input.actor.sub), kind: input.kind,
        fields: this.parityFields(wanted.cells, actual), direction: 'export_db', at: this.now() });
      this.journal.checkpoints.set(key, { fingerprint: input.expectedSheetFingerprint, cells: actual, version: '', at: this.now() });
      return this.execute();
    });
    this.tail = next.catch(() => {});
    return next;
  }
  private async execute(): Promise<ExportParity> {
    const rows = await contentExportRows(this.db);
    // One inventory read per collection on ordinary repair. Fresh reads are
    // reserved for changed rows immediately before their write and read-back.
    const inventories = new Map<ExportKind, Awaited<ReturnType<ContentExporter['tab']>>>();
    for (const row of rows) {
      const key = exportKey(row.kind, row.id);
      try {
        const checkpoint = this.journal.checkpoints.get(key);
        let inventory = inventories.get(row.kind);
        if (!inventory) { inventory = await this.tab(row.kind); inventories.set(row.kind, inventory); }
        const observed = inventory.data.find(r => r.id === row.id);
        if (checkpoint && !this.journal.issues.has(key) && checkpoint.version === row.version && observed
          && revision(observed.raw, inventory.headers.length) === checkpoint.fingerprint
          && different(checkpoint.cells, this.observed(observed.raw, inventory.headers)).length === 0) continue;
        this.pending.set(key, this.pending.get(key) ?? this.now());
        const { spec, headers, data } = await this.tab(row.kind);
        if (Object.keys(row.cells).some(h => !headers.includes(h))) { this.issue(row, ['@headers'], 'export_mismatch'); continue; }
        const current = data.find(r => r.id === row.id);
        if (!current) {
          // Only a genuinely new Queue idea can be appended. A missing exported
          // row is a deletion conflict, never a license to recreate it.
          if (row.kind !== 'queue' || row.importedRevision || checkpoint) { this.issue(row, ['@missing'], 'export_mismatch'); continue; }
          if (Object.values(row.cells).some(c => c.formula || c.link && c.link !== c.value)) { this.issue(row, ['@links'], 'export_mismatch'); continue; }
          await this.sheet.appendRow(spec.name, 'ZZ', headers.map(h => row.cells[h]?.value ?? ''));
        } else {
          const actual = this.observed(current.raw, headers);
          const fingerprint = revision(current.raw, headers.length);
          if (!checkpoint && Object.keys(row.cells).some(h => (row.cells[h]?.link ?? '') !== (actual[h]?.link ?? ''))) {
            this.issue(row, Object.keys(row.cells).filter(h => (row.cells[h]?.link ?? '') !== (actual[h]?.link ?? '')), 'export_mismatch'); continue;
          }
          if (checkpoint ? fingerprint !== checkpoint.fingerprint || different(checkpoint.cells, actual).length > 0
            : row.importedRevision ? fingerprint !== row.importedRevision : different(row.cells, actual).length > 0) {
            this.issue(row, different(checkpoint?.cells ?? row.cells, actual).length ? different(checkpoint?.cells ?? row.cells, actual) : ['@fingerprint'], 'export_mismatch'); continue;
          }
          const writes: CellWrite[] = [];
          for (const [header, wanted] of Object.entries(row.cells)) {
            const column = headers.indexOf(header), existing = rawCell(current.raw, column);
            // Preserve formulas and rich hyperlinks. RAW cannot change their
            // display and target independently; an impossible export blocks parity.
            if (existing.formula || wanted.formula || wanted.link && wanted.link !== wanted.value) continue;
            if (different({ cell: wanted }, { cell: existing }).length) writes.push({ row: current.row, column, value: wanted.value });
          }
          if (writes.length) await this.sheet.writeCells(spec.name, writes);
        }
        const fresh = await this.tab(row.kind), readback = fresh.data.find(r => r.id === row.id);
        if (!readback) { this.issue(row, ['@missing'], 'export_lag'); continue; }
        const actual = this.observed(readback.raw, fresh.headers);
        // Keep formulas in the precondition checkpoint; parity compares their
        // display/links to the DB, never demands conversion to plain values.
        const fields = this.parityFields(row.cells, actual);
        if (fields.length) { this.issue(row, fields, 'export_mismatch'); continue; }
        this.journal.checkpoints.set(key, { fingerprint: revision(readback.raw, fresh.headers.length), cells: actual, version: row.version, at: this.now() });
        this.lagSamples.push({ at: this.now(), lagMs: this.now() - this.pending.get(key)! });
        this.pending.delete(key);
        const failure = this.journal.issues.get(key);
        if (failure) this.repairedFailures.push({ since: failure.since, repairedAt: this.now() });
        this.journal.issues.delete(key);
      } catch { this.issue(row, ['@provider'], 'export_lag'); }
    }
    return this.parity();
  }
  comparison(now = this.now(), mutationCount = 0) {
    const day = 86400_000, today = Math.floor((now + 8 * 3600_000) / day) * day - 8 * 3600_000;
    const daily = [];
    for (let start = today - 14 * day; start < today; start += day) {
      const end = start + day, reports = this.journal.reports.filter(r => r.at >= start && r.at < end);
      const lags = this.lagSamples.filter(s => s.at >= start && s.at < end).map(s => s.lagMs).sort((a, b) => a - b);
      const lagP95 = lags.length ? lags[Math.ceil(lags.length * .95) - 1]! : null;
      const longFailure = this.repairedFailures.some(f => f.since < end && f.repairedAt >= start && Math.min(f.repairedAt, end) - f.since > 3600_000)
        || [...this.journal.issues.values()].some(f => f.since < end && Math.min(now, end) - f.since > 3600_000);
      daily.push({ day: new Date(start + 8 * 3600_000).toISOString().slice(0, 10), samples: reports.length,
        exact: reports.length ? reports.every(r => r.exact && r.dbHash === r.sheetHash) : null, lagP95, longFailure,
        green: reports.length > 0 && reports.every(r => r.exact && r.dbHash === r.sheetHash) && lagP95 !== null && lagP95 <= 900_000 && !longFailure });
    }
    return { daily, mutationCount, ready: mutationCount >= 50 && daily.every(d => d.green), scope: 'this server instance; live gates pending' as const };
  }
  private parityFields(expected: Record<string, ExportCell>, actual: Record<string, ExportCell>) {
    const display = (cells: Record<string, ExportCell>) => Object.fromEntries(Object.entries(cells).map(([h, c]) => [h, { value: c.value, ...(c.link ? { link: c.link } : {}) }]));
    return different(display(expected), display(actual));
  }
  /** Fresh exact inventory, including unexpected Sheet IDs; no representation exceptions. */
  async parity(): Promise<ExportParity> {
    const rows = await contentExportRows(this.db), differences: ExportIssue[] = [], dbProjection: unknown[] = [], sheetProjection: unknown[] = [];
    const counts = { library: 0, queue: 0, schedule: 0, workflow_settings: 0 };
    for (const kind of Object.keys(counts) as ExportKind[]) {
      const expected = rows.filter(r => r.kind === kind), tab = await this.tab(kind);
      counts[kind] = expected.length;
      for (const id of [...new Set([...expected.map(r => r.id), ...tab.data.map(r => r.id)])].sort()) {
        const wanted = expected.find(r => r.id === id), current = tab.data.find(r => r.id === id);
        const project = (cells: Record<string, ExportCell>) => Object.fromEntries(Object.entries(cells).map(([h, c]) => [h, { value: c.value, ...(c.link ? { link: c.link } : {}) }]));
        const actual = current ? this.observed(current.raw, tab.headers) : null;
        if (wanted) dbProjection.push({ kind, id, cells: project(wanted.cells) });
        if (actual) sheetProjection.push({ kind, id, cells: project(actual) });
        const fields = !wanted ? ['@unexpected'] : !actual ? ['@missing'] : this.parityFields(wanted.cells, actual);
        if (fields.length) differences.push({ kind, id, fields, reason: 'export_mismatch', since: this.now() });
      }
    }
    const report = { at: this.now(), exact: differences.length === 0, counts, dbHash: mirrorHash(dbProjection), sheetHash: mirrorHash(sheetProjection), differences };
    this.journal.reports.push(report);
    return report;
  }
}

/** One mutation boundary covers every repository write, including saga and
 * Replies Queue inserts. Export failure cannot turn a committed DB save into failure. */
export class ContentWriteCutover {
  private tail: Promise<unknown> = Promise.resolve();
  private readOnly = false;
  private readonly completed = new Set<string>();
  readonly repo: ContentRepository;
  constructor(repo: ContentRepository, readonly exporter: ContentExporter) {
    this.repo = new Proxy(repo, { get: (target, property) => {
      const original = Reflect.get(target, property);
      if (!['updateLibrary', 'updateQueue', 'updateSchedule', 'createQueueIdea'].includes(String(property))) return typeof original === 'function' ? original.bind(target) : original;
      return (mutation: { operationId: string }) => {
        const run = this.tail.then(async () => {
          if (this.readOnly) return { ok: false, operationId: mutation.operationId, code: 'FORBIDDEN', steps: [], details: { reason: 'rollback_read_only' } };
          const result = await original.call(target, mutation);
          if (result.ok) {
            if (!result.replayed && result.steps.some((step: { status: string }) => step.status === 'done')) this.completed.add(mutation.operationId);
            await exporter.run().catch(() => {});
          }
          return result;
        });
        this.tail = run.catch(() => {});
        return run;
      };
    } });
  }
  get mutationCount() { return this.completed.size; }
  async disableWrites() { this.readOnly = true; await this.tail; }
  /** Failure deliberately leaves DB read-only. No automatic re-enable. */
  async rollbackToSheet(flip: (mode: 'sheet') => Promise<void>) {
    await this.disableWrites();
    await this.exporter.run();
    const parity = await this.exporter.parity();
    if (!parity.exact || parity.dbHash !== parity.sheetHash || this.exporter.journal.issues.size) throw new AppError('CONFLICT', { reason: 'rollback_export_not_exact' });
    await flip('sheet');
    return { mode: 'sheet' as const, writesDisabled: true, parity };
  }
}
