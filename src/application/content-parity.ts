import 'server-only';
import type { ContentRepository } from './ports';
import { canonicalJson, evidenceHash } from './sheet-mirror';
import { classifyDifference } from './content-import';
import type { ImportEnvelope } from './content-import';
import { emit } from '@/observability/events';

export const PARITY_COLLECTIONS = ['library', 'queue', 'ready', 'schedule', 'queue_summary', 'workflow_settings'] as const;
export type ParityCollection = typeof PARITY_COLLECTIONS[number];
export type ParityFact = { collection: ParityCollection; field: string; kind: 'equal' | 'missing' | 'unexpected' | 'changed' | 'number_formatting' | 'trailing_whitespace' | 'blank_boolean' | 'boolean_formatting' | 'timestamp_formatting' | 'zero_row_source'; fingerprint: string };
export type FullImportParity = { rows: number; idsEqual: boolean; fields: number; equal: number; unclassified: number };
export type WindowWaiver = { by: 'owner'; on: '2026-10-25'; recordedAt: string };
export type ImportEvidence = Pick<ImportEnvelope, 'counts' | 'hashes' | 'exceptions' | 'snapshotHash'> & { fullParity?: FullImportParity; windowWaiver?: WindowWaiver | null };
export type ParitySample = { at: number; collection: ParityCollection; idsEqual: boolean; fields: number; equal: number; blocking: number; lagMs: number | null; facts: ParityFact[] };
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
function flatten(value: unknown, prefix = ''): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length) return Object.fromEntries(Object.entries(object(value)).flatMap(([k, v]) => Object.entries(flatten(v, prefix ? `${prefix}.${k}` : k))));
  return { [prefix]: value };
}
function indexed(collection: ParityCollection, input: unknown): Map<string, unknown> {
  if (collection === 'workflow_settings') {
    const settings = object(input), notes = object(settings.rawNotes);
    return new Map([...Object.entries(object(settings.raw)).map(([key, value]) => [`setting\0${key}`, { value, notes: notes[key] ?? '' }] as [string, unknown]),
      ['@derived', { timezone: settings.timezone, slots: settings.slots, problems: settings.problems }]]);
  }
  return new Map((input as unknown[]).map((v, i) => {
    const r = object(v), value = object(r.value);
    return [String(value.libraryId ?? value.contentId ?? r.source ?? i), v];
  }));
}

/** Adapter-level comparison: revisions/positions/formula machinery are not content. */
export function compareContent(collection: ParityCollection, expected: unknown, actual: unknown, at: number, lastImport: number | null): ParitySample {
  const left = indexed(collection, expected), right = indexed(collection, actual);
  const facts: ParityFact[] = [];
  let idsEqual = true, fields = 0, equal = 0, blocking = 0;
  const fact = (id: string, field: string, kind: ParityFact['kind']) => {
    facts.push({ collection, field, kind, fingerprint: evidenceHash([collection, id, field]).slice(0, 16) });
  };
  if (collection !== 'workflow_settings' && ((expected as unknown[]).length !== left.size || (actual as unknown[]).length !== right.size)) {
    idsEqual = false; blocking++; fact('duplicate', 'stable_id', 'changed');
  }
  for (const id of new Set([...left.keys(), ...right.keys()])) {
    const a = left.get(id), b = right.get(id);
    if (a === undefined || b === undefined) {
      idsEqual = false;
      const summary = object(a);
      const zero = collection === 'queue_summary' && a !== undefined && Object.values(object(summary.counts)).every(n => n === 0 || n === null);
      fact(id, 'stable_id', zero ? 'zero_row_source' : a === undefined ? 'unexpected' : 'missing');
      // Known zero-row view limitation is named, but still fails the ID-set gate.
      blocking++;
      continue;
    }
    const project = (v: unknown) => object(v).cells ? { cells: object(v).cells, links: object(v).links, value: object(v).value, passthrough: object(v).passthrough ?? {} } : v;
    const af = flatten(project(a)), bf = flatten(project(b));
    for (const field of new Set([...Object.keys(af), ...Object.keys(bf)])) {
      fields++;
      if (canonicalJson([af[field]]) === canonicalJson([bf[field]])) { equal++; continue; }
      const kind = field.startsWith('cells.') ? classifyDifference(af[field], bf[field], field.slice(6)) : null;
      fact(id, collection === 'queue_summary' && field.startsWith('counts.') ? 'counts' : field, kind ?? 'changed');
      // Sheet's blank checkbox is false. Name this single semantic equivalence
      // explicitly so real unposted rows can pass Phase B; all other classified
      // text changes (especially whitespace) remain unequal fields.
      if (kind === 'blank_boolean') equal++;
      if (!kind) blocking++;
    }
  }
  return { at, collection, idsEqual, fields, equal, blocking, lagMs: lastImport === null ? null : Math.max(0, at - lastImport), facts };
}

/** Content-free recorded facts. Instance-scoped until a durable deployment sink is wired. */
export class ContentParityJournal {
  readonly scope: string = 'this server instance';
  available = true;
  gap: 'CONFIG_MISSING' | 'SAMPLE_PERSISTENCE_FAILED' | 'HISTORY_UNAVAILABLE' | null = null;
  async prepare(): Promise<void> { /* Instance journal needs no I/O. */ }
  async refresh(): Promise<void> { /* Durable implementation reloads recorded facts. */ }
  readonly samples: ParitySample[] = [];
  lastImport: number | null = null;
  failureSince: number | null = null;
  protected readonly repairedFailures: { since: number; repairedAt: number }[] = [];
  lastRun: ImportEvidence | null = null;
  imported(at: number, evidence?: ImportEnvelope) {
    if (this.failureSince !== null) this.repairedFailures.push({ since: this.failureSince, repairedAt: at });
    if (this.repairedFailures.length > 10_000) this.repairedFailures.shift();
    this.lastImport = at; this.failureSince = null;
    if (evidence) this.lastRun = structuredClone({ counts: evidence.counts, hashes: evidence.hashes, exceptions: evidence.exceptions, snapshotHash: evidence.snapshotHash });
  }
  failed(at: number) { this.failureSince ??= at; }
  record(sample: ParitySample): void | Promise<void> {
    this.samples.push(sample);
    if (this.samples.length > 10_000) this.samples.shift();
    emit({ name: 'content.parity', adapter: 'app', outcome: sample.blocking || !sample.idsEqual ? 'blocked' : 'ok',
      facts: { collection: sample.collection, fields: sample.fields, equal: sample.equal, differences: sample.facts.length, blocking: sample.blocking, idsEqual: sample.idsEqual } });
  }
  summary(now = Date.now()) {
    const day = 86400_000, today = Math.floor(now / day) * day;
    const history = this.samples.filter(s => s.at <= now && now - s.at <= 30 * day).sort((a, b) => a.at - b.at);
    // Keep seven complete days plus today, or the latest 200 requests if longer.
    // A repaired mismatch outside that window must not hold the gate red for 30 days.
    const windowStart = Math.min(today - 7 * day, history[Math.max(0, history.length - 200)]?.at ?? now);
    const samples = history.filter(s => s.at >= windowStart);
    const failures = [...this.repairedFailures, ...(this.failureSince === null ? [] : [{ since: this.failureSince, repairedAt: now }])];
    const longFailure = (start: number, end: number) => failures.some(f => f.repairedAt >= start && f.since < end && Math.min(f.repairedAt, end) - f.since > 3600_000);
    const collections = PARITY_COLLECTIONS.map(collection => {
      const rows = samples.filter(s => s.collection === collection);
      const fields = rows.reduce((n, s) => n + s.fields, 0);
      return { collection, samples: rows.length, idsEqual: rows.length ? rows.every(s => s.idsEqual) : null,
        fieldEquality: fields ? 100 * rows.reduce((n, s) => n + s.equal, 0) / fields : rows.length && rows.every(s => s.idsEqual && s.blocking === 0) ? 100 : null,
        fieldsNA: rows.length > 0 && fields === 0 && rows.every(s => s.idsEqual && s.blocking === 0),
        blankBooleans: rows.reduce((n, s) => n + s.facts.filter(f => f.kind === 'blank_boolean').length, 0),
        blocking: rows.reduce((n, s) => n + s.blocking, 0) };
    });
    const lags = samples.flatMap(s => s.lagMs === null ? [] : [s.lagMs]).sort((a, b) => a - b);
    const lagP95 = lags.length ? lags[Math.ceil(lags.length * .95) - 1]! : null;
    // A missing day or a red sample breaks the streak. Today's partial day is not a green day.
    let daysGreen = 0;
    for (let end = today; end > today - 30 * day; end -= day) {
      const rows = history.filter(s => s.at >= end - day && s.at < end);
      if (longFailure(end - day, end) || !PARITY_COLLECTIONS.every(c => rows.some(s => s.collection === c)) || rows.some(s => !s.idsEqual || s.blocking || s.lagMs === null || s.lagMs > 900_000 || s.fields && s.equal / s.fields < .999)) break;
      daysGreen++;
    }
    const lagMs = this.lastImport === null ? null : Math.max(0, now - this.lastImport);
    const full = this.lastRun?.fullParity;
    const waiver = process.env.CS_PARITY_WINDOW_WAIVED === '2026-10-25' ? this.lastRun?.windowWaiver ?? null : null;
    const providerFailures = samples.filter(s => s.facts.some(f => f.field === 'provider')).length;
    const fullImportReady = !!full && full.rows === Object.values(this.lastRun!.counts).reduce((a, b) => a + b, 0) && full.idsEqual && full.unclassified === 0
      && (full.fields === 0 ? full.rows === 0 && full.equal === 0 : full.equal / full.fields >= .999)
      && !this.lastRun!.exceptions.some(e => e.class.startsWith('refused_'));
    const comparisons = samples.filter(s => !s.facts.some(f => f.field === 'provider'));
    const sampledEquality = PARITY_COLLECTIONS.every(collection => {
      const rows = comparisons.filter(s => s.collection === collection);
      const fields = rows.reduce((n, s) => n + s.fields, 0), equal = rows.reduce((n, s) => n + s.equal, 0);
      return rows.every(s => s.idsEqual && s.blocking === 0 && s.lagMs !== null) && (fields === 0 || equal / fields >= .999);
    });
    const measuredReady = fullImportReady && sampledEquality && lagP95 !== null && lagP95 <= 900_000 && !longFailure(windowStart, now);
    const windowReady = fullImportReady && this.available && samples.length >= 200 && samples.every(s => s.lagMs !== null) && daysGreen >= 7 && collections.every(c => c.idsEqual === true && c.fieldEquality !== null && c.fieldEquality >= 99.9 && c.blocking === 0)
      && lagP95 !== null && lagP95 <= 900_000 && lagMs !== null && lagMs <= 900_000 && !longFailure(windowStart, now);
    const ready = this.available && this.gap === null && (waiver ? measuredReady : windowReady);
    return { gap: this.gap, windowWaiver: waiver, fullParity: full ?? null, providerFailures, collections, sampleCount: samples.length, lagP95, daysGreen, lagMs, failureSince: this.failureSince, lastRun: this.lastRun, ready, scope: this.scope, available: this.available };
  }
}

const methods = { listLibrary: 'library', listQueue: 'queue', listReadyQueue: 'ready', listSchedule: 'schedule', queueSummary: 'queue_summary', workflowSettings: 'workflow_settings' } as const;
async function boundedComparison<T>(read: Promise<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([read, new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 500); })]); }
  finally { clearTimeout(timer); }
}
/** Await bounded DB work on sampled list calls; never re-read the Sheet or serve DB values. */
export function shadowContentRepository(sheet: ContentRepository, db: ContentRepository, journal: ContentParityJournal, sample = () => Math.random() < .1): ContentRepository {
  return new Proxy(sheet, { get(target, property) {
    const original = Reflect.get(target, property);
    const collection = methods[property as keyof typeof methods];
    if (!collection || typeof original !== 'function') return typeof original === 'function' ? original.bind(target) : original;
    return async () => {
      // Resolve synchronous throws, async failures and journal failures behind
      // the same fail-open boundary. No shadow code can reject the Sheet call.
      let selected = false;
      try { selected = sample(); } catch { journal.available = false; }
      const dbRead = selected ? boundedComparison(Promise.resolve().then(async () => {
        await journal.prepare();
        return { value: await (db[property as keyof typeof methods] as () => Promise<unknown>).call(db), lastImport: journal.lastImport };
      }).catch(() => null)) : null;
      const result = await original.call(target);
      if (selected) {
        try {
          const compared = await dbRead;
          const observation = compared ? compareContent(collection, result, compared.value, Date.now(), compared.lastImport)
            : { at: Date.now(), collection, idsEqual: false, fields: 0, equal: 0, blocking: 1, lagMs: null,
              facts: [{ collection, field: 'provider', kind: 'changed' as const, fingerprint: evidenceHash(collection).slice(0, 16) }] };
          const saved = await boundedComparison(Promise.resolve(journal.record(observation)).then(() => true).catch(() => false));
          if (!saved) { journal.available = false; journal.gap = 'SAMPLE_PERSISTENCE_FAILED'; }
        } catch { journal.available = false; journal.gap = 'SAMPLE_PERSISTENCE_FAILED'; }
      }
      return result;
    };
  } });
}
