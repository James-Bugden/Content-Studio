import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ContentParityJournal, PARITY_COLLECTIONS, type ParitySample } from '@/application/content-parity';
import { ContentShadowStore } from './content-shadow-store';
import type { SupabaseContentDbOptions } from './content-db';

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const sampleSchema = z.object({ at: count, collection: z.enum(PARITY_COLLECTIONS), idsEqual: z.boolean(), fields: count, equal: count, blocking: count,
  lagMs: count.nullable(), facts: z.array(z.object({ collection: z.enum(PARITY_COLLECTIONS), field: z.string().max(512),
    kind: z.enum(['equal', 'missing', 'unexpected', 'changed', 'number_formatting', 'trailing_whitespace', 'blank_boolean', 'boolean_formatting', 'timestamp_formatting', 'zero_row_source']), fingerprint: z.string().regex(/^[a-f0-9]{16}$/) }))
}).refine(s => s.equal <= s.fields && s.facts.every(f => f.collection === s.collection));
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const evidence = z.object({ snapshotHash: hash, counts: z.object({ library: count, queue: count, schedule: count, workflow_settings: count }),
  hashes: z.object({ library: hash, queue: hash, schedule: hash, workflow_settings: hash }),
  exceptions: z.array(z.object({ class: z.enum(['formula_display', 'number_formatting', 'trailing_whitespace', 'blank_boolean', 'boolean_formatting', 'timestamp_formatting', 'refused_numeric', 'refused_size']), collection: z.enum(['library', 'queue', 'schedule', 'workflow_settings']), field: z.string(), hash })) });
const eventSchema = z.object({ event_id: z.string().uuid(), at: z.string().refine(s => Number.isFinite(Date.parse(s))), kind: z.enum(['sample', 'imported', 'failed']), payload: z.unknown() });
const imported = z.object({ snapshotAt: count, evidence });

/** Reconstructs the gate calculation from one complete database snapshot. */
export class SupabaseContentParityJournal extends ContentParityJournal {
  override readonly scope = 'durable database history';
  private readonly store: ContentShadowStore;
  constructor(options: SupabaseContentDbOptions) { super(); this.store = new ContentShadowStore(options); }
  override async prepare() {
    const rows = await this.store.rows({ kind: 'eq.imported', order: 'at.desc,event_id.desc', limit: '1' });
    this.lastImport = rows.length ? imported.parse(eventSchema.parse(rows[0]).payload).snapshotAt : null;
  }
  override async record(sample: ParitySample) {
    const payload = sampleSchema.parse(sample);
    z.object({ ok: z.literal(true) }).parse(await this.store.rpc('sample', { p_event_id: randomUUID(), p_sample: payload }));
    super.record(payload);
  }
  override async refresh() {
    try {
      // Read all events: do not truncate a high-volume history and then call it
      // a complete window. The calculator itself selects the last 30 days.
      const rows = z.array(eventSchema).parse(await this.store.rpc('history', {}));
      this.samples.length = 0; this.repairedFailures.length = 0;
      this.lastImport = null; this.failureSince = null; this.lastRun = null;
      for (const row of rows) {
        if (row.kind === 'sample') this.samples.push(sampleSchema.parse(row.payload));
        else if (row.kind === 'failed') this.failed(Date.parse(row.at));
        else {
          const payload = imported.parse(row.payload);
          // Failure duration uses the completion time, lag uses source capture.
          this.imported(Date.parse(row.at)); this.lastImport = payload.snapshotAt;
          this.lastRun = payload.evidence;
        }
      }
      this.available = true;
    } catch {
      // Never present stale cached measurements as a pass after failed reload.
      this.available = false; this.samples.length = 0; this.lastImport = null; this.lastRun = null;
    }
  }
}
