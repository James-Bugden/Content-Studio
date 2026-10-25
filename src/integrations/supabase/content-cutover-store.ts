import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '@/domain/errors';
import type { ContentRepository } from '@/application/ports';
import type { ContentExportJournal, ExportCheckpoint, ExportIssue, ExportParity } from '@/application/content-export';
import type { BackupJournal, ContentBackupSnapshot, ContentBackupSource } from '@/application/content-backup';
import { BACKUP_TABLES, backupJournalSchema } from '@/application/content-backup';
import { mirrorHash } from '@/application/sheet-mirror';
import { ContentShadowStore } from './content-shadow-store';
import type { SupabaseContentDbOptions } from './content-db';

const ok = z.object({ ok: z.literal(true) });
const stateSchema = z.object({ checkpoints: z.array(z.tuple([z.string(), z.object({ fingerprint: z.string().regex(/^[a-f0-9]{16}$/),
  cells: z.record(z.string(), z.object({ value: z.string(), formula: z.string().optional(), link: z.string().optional(), type: z.literal('boolean').optional() })),
  version: z.string(), at: z.number().nonnegative() })])), issues: z.array(z.tuple([z.string(), z.object({
  kind: z.enum(['library', 'queue', 'schedule', 'workflow_settings']), id: z.string(), fields: z.array(z.string()), since: z.number(),
  reason: z.enum(['export_mismatch', 'export_lag']), lagSince: z.number().optional(), recovery: z.literal('change_authoritative_value').optional(),
})])), reports: z.array(z.custom<ExportParity>(v => !!v && typeof v === 'object' && 'exact' in v && typeof v.exact === 'boolean')),
  lagSamples: z.array(z.object({ at: z.number(), lagMs: z.number().nonnegative() })).default([]),
  repairedFailures: z.array(z.object({ since: z.number(), repairedAt: z.number() })).default([]) });

/** Private state and non-expiring distributed worker locks. Crashed workers
 * require an explicit drain/recovery; time alone never authorizes a second
 * Google writer while an earlier request could still be executing. */
export class ContentCutoverStore implements ContentBackupSource {
  private readonly rest: ContentShadowStore;
  readonly exportJournal: ContentExportJournal;
  readonly backupJournal: BackupJournal = { lastVerified: null, failureSince: null };
  private exportToken?: string;
  constructor(options: SupabaseContentDbOptions, readonly build: string, private readonly mode: 'db-read' | 'db' = 'db-read') {
    this.rest = new ContentShadowStore(options);
    this.exportJournal = { checkpoints: new Map(), issues: new Map(), reports: [], live: {
      exclusive: run => this.exclusive('sheet-export', async (state, token) => {
        this.restoreExport(state);
        this.exportToken = token;
        try { return await run(); } finally { this.exportToken = undefined; }
      }),
      persist: async () => {
        if (!this.exportToken) throw new AppError('FORBIDDEN');
        ok.parse(await this.rest.cutoverRpc('save', { p_name: 'sheet-export', p_token: this.exportToken, p_state: this.exportState() }));
      },
    } };
  }
  private restoreExport(state: unknown) {
    const parsed = stateSchema.parse(state ?? { checkpoints: [], issues: [], reports: [] });
    this.exportJournal.checkpoints = new Map(parsed.checkpoints.map(([k, v]) => [(JSON.parse(k) as string[]).join('\0'), v as ExportCheckpoint]));
    this.exportJournal.issues = new Map(parsed.issues.map(([k, v]) => [(JSON.parse(k) as string[]).join('\0'), v as ExportIssue]));
    this.exportJournal.reports = parsed.reports;
    this.exportJournal.lagSamples = parsed.lagSamples;
    this.exportJournal.repairedFailures = parsed.repairedFailures;
  }
  async refreshBackup() {
    try { Object.assign(this.backupJournal, backupJournalSchema.parse(await this.rest.cutoverRpc('read', { p_name: 'backup' }) ?? { lastVerified: null, failureSince: null })); }
    catch (error) { this.backupJournal.lastVerified = null; this.backupJournal.failureSince ??= Date.now(); throw error; }
  }
  private exportState() { return { checkpoints: [...this.exportJournal.checkpoints].map(([k, v]) => [JSON.stringify(k.split('\0')), v]),
    issues: [...this.exportJournal.issues].map(([k, v]) => [JSON.stringify(k.split('\0')), v]), reports: this.exportJournal.reports,
    lagSamples: this.exportJournal.lagSamples ?? [], repairedFailures: this.exportJournal.repairedFailures ?? [] }; }
  async record(name: 'parity' | 'rehearsal' | 'backup', importId: string, payload: unknown) {
    ok.parse(await this.rest.cutoverRpc('record', { p_name: name, p_build: this.build, p_import_id: importId, p_payload: payload }));
  }
  async operation(action: string, id: string, run: () => Promise<unknown>) {
    const token = randomUUID(), hash = mirrorHash([this.build, this.mode, action]);
    const params = { p_id: id, p_hash: hash, p_token: token, p_result: null as unknown };
    const claim = z.object({ status: z.enum(['acquired', 'replayed']), result: z.unknown().optional() }).parse(await this.rest.cutoverRpc('operation', params));
    // Readiness to flip is never replayed from a historical Sheet observation.
    // Repeat verification even for a lost-response retry of rollback.
    if (claim.status === 'replayed') return action === 'rollback' ? run() : claim.result;
    const result = await run();
    z.object({ status: z.literal('completed') }).parse(await this.rest.cutoverRpc('operation', { ...params, p_result: result }));
    return result;
  }
  async assertGate(mode: 'db-read' | 'db') {
    ok.parse(await this.rest.cutoverRpc('gate', { p_mode: mode, p_build: this.build }));
  }
  guard(repo: ContentRepository, mode: 'db-read' | 'db'): ContentRepository {
    return new Proxy(repo, { get: (target, key) => {
      const value = Reflect.get(target, key);
      if (typeof value !== 'function' || ['capability', 'mutationProvider', 'draftBodyAuthority', 'pendingRefresh'].includes(String(key))) return typeof value === 'function' ? value.bind(target) : value;
      return async (...args: unknown[]) => { await this.assertGate(mode); return value.apply(target, args); };
    } });
  }
  async exclusive<T>(name: string, run: (state: unknown, token: string) => Promise<T>): Promise<T> {
    await this.assertGate(this.mode);
    // Reload known mismatches even if a different/crashed worker holds the
    // lock: a failed fresh inspection cannot hide a persisted blocking issue.
    if (name === 'sheet-export') this.restoreExport(await this.rest.cutoverRpc('read', { p_name: name }));
    const token = randomUUID();
    const claim = z.object({ ok: z.literal(true), state: z.unknown() }).parse(await this.rest.cutoverRpc('claim', { p_name: name, p_token: token }));
    // Do not unlock on ambiguous failed state persistence. Explicit recovery
    // inspects the Sheet before permitting the next worker.
    let complete = false;
    try {
      const result = await run(claim.state, token);
      const state = name === 'sheet-export' ? this.exportState() : name === 'backup' ? this.backupJournal : claim.state;
      ok.parse(await this.rest.cutoverRpc('save', { p_name: name, p_token: token, p_state: state ?? null }));
      complete = true;
      return result;
    } catch (error) {
      if (name === 'backup') {
        this.backupJournal.failureSince ??= Date.now();
        // Keep the prior verified archive AND the failed attempt visible after
        // restart. This is evidence only; the ambiguous worker stays locked.
        await this.rest.cutoverRpc('save', { p_name: name, p_token: token, p_state: this.backupJournal }).catch(() => {});
      }
      throw error;
    } finally {
      if (complete) ok.parse(await this.rest.cutoverRpc('release', { p_name: name, p_token: token }));
    }
  }
  async snapshot(): Promise<ContentBackupSnapshot> {
    const rows = z.record(z.string(), z.array(z.record(z.string(), z.unknown()))).parse(await this.rest.cutoverRpc('snapshot', {}));
    if (BACKUP_TABLES.some(t => !rows[t])) throw new AppError('SCHEMA_DRIFT');
    return rows as ContentBackupSnapshot;
  }
}
