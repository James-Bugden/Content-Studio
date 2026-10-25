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
import { CUTOVER_CONTRACT } from '@/application/cutover-contract';

const ok = z.object({ ok: z.literal(true) });
const stateSchema = z.object({ checkpoints: z.array(z.tuple([z.string(), z.object({ fingerprint: z.string().regex(/^[a-f0-9]{16}$/),
  cells: z.record(z.string(), z.object({ value: z.string(), formula: z.string().optional(), link: z.string().optional(), type: z.literal('boolean').optional() })),
  version: z.string(), at: z.number().nonnegative() })])), issues: z.array(z.tuple([z.string(), z.object({
  kind: z.enum(['library', 'queue', 'schedule', 'workflow_settings']), id: z.string(), fields: z.array(z.string()), since: z.number(),
  reason: z.enum(['export_mismatch', 'export_lag']), lagSince: z.number().optional(), recovery: z.literal('change_authoritative_value').optional(),
})])), reports: z.array(z.custom<ExportParity>(v => !!v && typeof v === 'object' && 'exact' in v && typeof v.exact === 'boolean')),
  lagSamples: z.array(z.object({ at: z.number(), lagMs: z.number().nonnegative() })).default([]),
  repairedFailures: z.array(z.object({ since: z.number(), repairedAt: z.number() })).default([]) });

/** Private state with expiring leases and a token fence before provider writes. */
export class ContentCutoverStore implements ContentBackupSource {
  private readonly rest: ContentShadowStore;
  readonly exportJournal: ContentExportJournal;
  readonly backupJournal: BackupJournal = { lastVerified: null, failureSince: null };
  private exportToken?: string;
  blocking?: string;
  constructor(options: SupabaseContentDbOptions, readonly build: string, private readonly mode: 'db-read' | 'db' = 'db-read', readonly contract = CUTOVER_CONTRACT) {
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
      refresh: async () => { await this.assertRecovery(); this.restoreExport(await this.rest.cutoverRpc('read', { p_name: 'sheet-export' })); },
      fence: () => this.fence('sheet-export', this.exportToken),
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
  private exportState() {
    this.exportJournal.reports = this.exportJournal.reports.slice(-2048);
    this.exportJournal.lagSamples = (this.exportJournal.lagSamples ?? []).slice(-4096);
    this.exportJournal.repairedFailures = (this.exportJournal.repairedFailures ?? []).slice(-2048);
    const state = { checkpoints: [...this.exportJournal.checkpoints].map(([k, v]) => [JSON.stringify(k.split('\0')), v]),
      issues: [...this.exportJournal.issues].map(([k, v]) => [JSON.stringify(k.split('\0')), v]), reports: this.exportJournal.reports,
      lagSamples: this.exportJournal.lagSamples, repairedFailures: this.exportJournal.repairedFailures };
    // Never discard a conflict/checkpoint to fit a budget. Refuse further export
    // with DB saves/backups still safe; recovery requires operator inspection.
    if (this.exportJournal.checkpoints.size > 20000 || this.exportJournal.issues.size > 20000 || Buffer.byteLength(JSON.stringify(state)) > 64 * 1024 * 1024) {
      throw new AppError('SCHEMA_DRIFT', { reason: 'export_state_bound' });
    }
    return state;
  }
  async record(name: 'parity' | 'rehearsal' | 'backup', importId: string, payload: unknown) {
    ok.parse(await this.rest.cutoverRpc('record', { p_name: name, p_build: this.build, p_import_id: importId, p_payload: payload }));
  }
  async operation(action: string, id: string, run: () => Promise<unknown>) {
    const token = randomUUID(), hash = mirrorHash([this.contract, this.mode, action, ...(action.startsWith('activate-') ? [this.build] : [])]);
    const params = { p_id: id, p_hash: hash, p_token: token, p_result: null as unknown };
    const claim = z.object({ status: z.enum(['acquired', 'replayed']), result: z.unknown().optional() }).parse(await this.rest.cutoverRpc('operation', params));
    // Readiness to flip is never replayed from a historical Sheet observation.
    // Repeat verification even for a lost-response retry of rollback.
    if (claim.status === 'replayed') return action === 'rollback' ? run() : claim.result;
    try {
      const result = await run();
      z.object({ status: z.literal('completed') }).parse(await this.rest.cutoverRpc('operation', { ...params, p_result: result }));
      return result;
    } catch (error) {
      await this.rest.cutoverRpc('operation', { ...params, p_result: { retry: true } }).catch(() => {});
      throw error;
    }
  }
  async assertFlip(mode: 'db-read' | 'db') {
    ok.parse(await this.rest.cutoverRpc('gate', { p_mode: mode, p_build: this.build }));
  }
  async activate(mode: 'db-read' | 'db') {
    ok.parse(await this.rest.cutoverRpc('activate', { p_mode: mode, p_build: this.build, p_contract: this.contract }));
    return { mode, build: this.build, contract: this.contract };
  }
  async assertGate(mode: 'db-read' | 'db', write = false, recovery = false) {
    const result = z.object({ ok: z.literal(true), readOnly: z.boolean(), blocking: z.string().nullish() }).parse(await this.rest.cutoverRpc('authorize', {
      p_mode: mode, p_build: this.build, p_contract: this.contract, p_write: write, p_recovery: recovery,
    }));
    this.blocking = result.blocking ?? undefined;
    return result;
  }
  assertRecovery() { return this.assertGate(this.mode, false, true); }
  async fence(name: string, token?: string) {
    if (!token) throw new AppError('FORBIDDEN', { reason: 'worker_token_required' });
    ok.parse(await this.rest.cutoverRpc('fence', { p_name: name, p_token: token }));
  }
  guard(repo: ContentRepository, mode: 'db-read' | 'db'): ContentRepository {
    return new Proxy(repo, { get: (target, key) => {
      const value = Reflect.get(target, key);
      if (key === 'capability') return () => ({ ...target.capability(), ...(this.blocking ? { state: 'read_only' as const } : {}) });
      if (typeof value !== 'function' || ['capability', 'mutationProvider', 'draftBodyAuthority', 'pendingRefresh'].includes(String(key))) return typeof value === 'function' ? value.bind(target) : value;
      return async (...args: unknown[]) => {
        await this.assertGate(mode, ['updateLibrary', 'updateQueue', 'updateSchedule', 'createQueueIdea'].includes(String(key)));
        return value.apply(target, args);
      };
    } });
  }
  async exclusive<T>(name: string, run: (state: unknown, token: string) => Promise<T>): Promise<T> {
    await this.assertRecovery();
    // Reload known mismatches even if a different/crashed worker holds the
    // lock: a failed fresh inspection cannot hide a persisted blocking issue.
    if (name === 'sheet-export') this.restoreExport(await this.rest.cutoverRpc('read', { p_name: name }));
    const token = randomUUID();
    try {
      const claim = z.object({ ok: z.literal(true), state: z.unknown() }).parse(await this.rest.cutoverRpc('claim', { p_name: name, p_token: token }));
      const result = await run(claim.state, token);
      const state = name === 'sheet-export' ? this.exportState() : name === 'backup' ? this.backupJournal : claim.state;
      ok.parse(await this.rest.cutoverRpc('save', { p_name: name, p_token: token, p_state: state ?? null }));
      return result;
    } catch (error) {
      if (name === 'backup') {
        this.backupJournal.failureSince ??= Date.now();
        // Keep the prior verified archive AND the failed attempt visible after
        // restart. The finally block releases this worker's lease.
        await this.rest.cutoverRpc('save', { p_name: name, p_token: token, p_state: this.backupJournal }).catch(() => {});
      }
      throw error;
    } finally {
      // Release on every settled failure. If SQL is unavailable, the lease
      // expires; the old token cannot persist or write after recovery.
      await this.rest.cutoverRpc('release', { p_name: name, p_token: token }).catch(() => {});
    }
  }
  async snapshot(): Promise<ContentBackupSnapshot> {
    const rows = z.record(z.string(), z.array(z.record(z.string(), z.unknown()))).parse(await this.rest.cutoverRpc('snapshot', {}));
    if (BACKUP_TABLES.some(t => !rows[t])) throw new AppError('SCHEMA_DRIFT');
    return rows as ContentBackupSnapshot;
  }
}
