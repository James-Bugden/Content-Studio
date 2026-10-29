import 'server-only';
import { AppError, isAppError } from '@/domain/errors';
import { BACKUP_RUNNING_TIMEOUT_MS, type BackupRunView, type BackupStatus } from '@/domain/weekly-backup';
import type { BackupBegin, BackupFinish, BackupRunStore } from '@/application/backup-ports';

type Row = {
  id: string; trigger_kind: 'cron' | 'manual'; status: 'running' | 'success' | 'failure'; started_at: string; finished_at: string | null;
  file_name: string | null; size_bytes: number | string | null; row_counts: Record<string, number> | null; error_message: string | null;
};
const COLUMNS = 'id,trigger_kind,status,started_at,finished_at,file_name,size_bytes,row_counts,error_message';
const view = (r: Row): BackupRunView => ({
  id: r.id, trigger: r.trigger_kind, status: r.status, startedAt: r.started_at, finishedAt: r.finished_at, fileName: r.file_name,
  sizeBytes: r.size_bytes === null ? null : Number(r.size_bytes), rowCounts: r.row_counts, errorMessage: r.error_message,
});

/** Run history in public.content_studio_backup_runs, service role over PostgREST. */
export class SupabaseBackupRunStore implements BackupRunStore {
  private readonly base: string;
  constructor(private readonly options: { url: string; serviceKey: string; fetch?: typeof fetch; now?: () => number }) {
    if (!/^(?:https:\/\/[a-z0-9-]+\.supabase\.co|http:\/\/(?:127\.0\.0\.1|localhost):54321)\/?$/i.test(options.url) || options.serviceKey.trim().length < 20) {
      throw new AppError('CONFIG_MISSING', { provider: 'db' });
    }
    this.base = options.url.replace(/\/$/, '');
  }
  private async call(method: string, query: string, body?: unknown, prefer?: string): Promise<unknown> {
    try {
      const response = await (this.options.fetch ?? fetch)(`${this.base}/rest/v1/content_studio_backup_runs${query}`, {
        method, cache: 'no-store', signal: AbortSignal.timeout(15_000),
        headers: { apikey: this.options.serviceKey, Authorization: `Bearer ${this.options.serviceKey}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) throw new AppError(response.status === 404 ? 'CONFIG_MISSING' : 'PROVIDER_UNAVAILABLE', { provider: 'db', reason: response.status === 404 ? 'backup_runs_table_missing' : 'backup_runs', httpStatus: response.status });
      return response.status === 204 ? null : await response.json().catch(() => null);
    } catch (error) {
      if (isAppError(error)) throw error;
      throw new AppError('PROVIDER_UNAVAILABLE', { provider: 'db', reason: 'network' });
    }
  }
  private async byId(id: string): Promise<BackupRunView | null> {
    const rows = await this.call('GET', `?select=${COLUMNS}&id=eq.${encodeURIComponent(id)}&limit=1`) as Row[];
    return rows[0] ? view(rows[0]) : null;
  }

  async begin(run: { id: string; trigger: 'cron' | 'manual'; startedAt: string; buildCommit: string | null }): Promise<BackupBegin> {
    const existing = await this.byId(run.id);
    if (existing) return { kind: 'replay', run: existing };
    const since = new Date((this.options.now?.() ?? Date.now()) - BACKUP_RUNNING_TIMEOUT_MS).toISOString();
    const active = await this.call('GET', `?select=${COLUMNS}&status=eq.running&started_at=gt.${encodeURIComponent(since)}&order=started_at.desc&limit=1`) as Row[];
    if (active[0]) return { kind: 'busy', run: view(active[0]) };
    // A raced duplicate id is ignored by the database and read back as a replay.
    const inserted = await this.call('POST', '', [{ id: run.id, trigger_kind: run.trigger, status: 'running', started_at: run.startedAt, build_commit: run.buildCommit }], 'resolution=ignore-duplicates,return=representation') as Row[] | null;
    if (!inserted?.length) {
      const again = await this.byId(run.id);
      if (again) return { kind: 'replay', run: again };
      throw new AppError('PROVIDER_UNAVAILABLE', { provider: 'db', reason: 'backup_runs' });
    }
    return { kind: 'started' };
  }

  async finish(id: string, result: BackupFinish): Promise<void> {
    await this.call('PATCH', `?id=eq.${encodeURIComponent(id)}&status=eq.running`, {
      status: result.status, finished_at: result.finishedAt, file_name: result.fileName ?? null, size_bytes: result.sizeBytes ?? null,
      row_counts: result.rowCounts ?? null, error_message: result.errorMessage ? result.errorMessage.slice(0, 300) : null, warnings: result.warnings ?? 0,
    });
  }

  async status(): Promise<BackupStatus> {
    const [last, success] = await Promise.all([
      this.call('GET', `?select=${COLUMNS}&order=started_at.desc&limit=1`) as Promise<Row[]>,
      this.call('GET', `?select=${COLUMNS}&status=eq.success&order=finished_at.desc&limit=1`) as Promise<Row[]>,
    ]);
    return { lastRun: last[0] ? view(last[0]) : null, lastSuccess: success[0] ? view(success[0]) : null };
  }
}

/** In-memory twin with the same replay, busy and status semantics. */
export class FakeBackupRunStore implements BackupRunStore {
  readonly runs = new Map<string, BackupRunView>();
  constructor(private readonly now: () => number = Date.now) {}
  async begin(run: { id: string; trigger: 'cron' | 'manual'; startedAt: string }): Promise<BackupBegin> {
    const existing = this.runs.get(run.id);
    if (existing) return { kind: 'replay', run: existing };
    const active = [...this.runs.values()].find(r => r.status === 'running' && this.now() - Date.parse(r.startedAt) < BACKUP_RUNNING_TIMEOUT_MS);
    if (active) return { kind: 'busy', run: active };
    this.runs.set(run.id, { id: run.id, trigger: run.trigger, status: 'running', startedAt: run.startedAt, finishedAt: null, fileName: null, sizeBytes: null, rowCounts: null, errorMessage: null });
    return { kind: 'started' };
  }
  async finish(id: string, result: BackupFinish): Promise<void> {
    const run = this.runs.get(id);
    if (!run || run.status !== 'running') return;
    this.runs.set(id, { ...run, status: result.status, finishedAt: result.finishedAt, fileName: result.fileName ?? null, sizeBytes: result.sizeBytes ?? null, rowCounts: result.rowCounts ?? null, errorMessage: result.errorMessage ?? null });
  }
  async status(): Promise<BackupStatus> {
    const all = [...this.runs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    const success = all.filter(r => r.status === 'success').sort((a, b) => (b.finishedAt ?? '').localeCompare(a.finishedAt ?? ''))[0] ?? null;
    return { lastRun: all[0] ?? null, lastSuccess: success };
  }
}
