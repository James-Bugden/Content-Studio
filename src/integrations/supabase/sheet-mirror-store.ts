import 'server-only';
import { AppError, isAppError } from '@/domain/errors';
import { canonicalJson, type MirrorApplyResult, type MirrorRow, type SheetMirrorSnapshot, type SheetMirrorStore } from '@/application/sheet-mirror';

type Fetch = typeof fetch;

export type SupabaseSheetMirrorOptions = {
  url: string;
  serviceKey: string;
  fetch?: Fetch;
  timeoutMs?: number;
  chunkBytes?: number;
  pageRows?: number;
};

type DbRow = {
  collection: MirrorRow['collection'];
  stable_id: string;
  position: number;
  source_row: number | null;
  source_revision: string | null;
  row_hash: string;
  payload: unknown;
};

type BeginResult = { state: 'staging'; staged: number } | ({ state: 'complete' } & MirrorApplyResult);

export class SupabaseSheetMirrorStore implements SheetMirrorStore {
  private readonly base: string;
  private readonly request: Fetch;
  private readonly timeoutMs: number;
  private readonly chunkBytes: number;
  private readonly pageRows: number;

  constructor(private readonly options: SupabaseSheetMirrorOptions) {
    if (!/^(?:https:\/\/[a-z0-9-]+\.supabase\.co|http:\/\/(?:127\.0\.0\.1|localhost):54321)\/?$/i.test(options.url)) {
      throw new AppError('CONFIG_MISSING', { provider: 'supabase', reason: 'url' });
    }
    if (options.serviceKey.trim().length < 20) throw new AppError('CONFIG_MISSING', { provider: 'supabase', reason: 'service_key' });
    this.base = options.url.replace(/\/$/, '');
    this.request = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.chunkBytes = options.chunkBytes ?? 512 * 1024;
    this.pageRows = options.pageRows ?? 1_000;
  }

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    try {
      const response = await this.request(`${this.base}/rest/v1/${path}`, {
        ...init,
        headers: {
          apikey: this.options.serviceKey,
          Authorization: `Bearer ${this.options.serviceKey}`,
          'Content-Type': 'application/json',
          ...init.headers,
        },
        cache: 'no-store',
        signal: init.signal ?? AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) {
        throw new AppError(response.status === 409 ? 'CONFLICT' : response.status === 429 ? 'RATE_LIMITED' : 'PROVIDER_UNAVAILABLE', {
          provider: 'supabase',
          httpStatus: response.status,
        });
      }
      return (await response.json()) as T;
    } catch (error) {
      if (isAppError(error)) throw error;
      throw new AppError('PROVIDER_UNAVAILABLE', { provider: 'supabase', reason: error instanceof DOMException && error.name === 'TimeoutError' ? 'timeout' : 'network' });
    }
  }

  private wireRow(item: MirrorRow) {
    return {
      collection: item.collection,
      stable_id: item.stableId,
      position: item.position,
      source_row: item.sourceRow,
      source_revision: item.sourceRevision,
      row_hash: item.rowHash,
      payload: item.payload,
    };
  }

  private chunks(rows: MirrorRow[]): MirrorRow[][] {
    const chunks: MirrorRow[][] = [];
    let current: MirrorRow[] = [];
    let bytes = 2;
    for (const item of rows) {
      const size = Buffer.byteLength(canonicalJson(this.wireRow(item)), 'utf8') + 1;
      if (size > this.chunkBytes) throw new AppError('VALIDATION_FAILED', { provider: 'supabase', reason: 'mirror_row_too_large' });
      if (current.length > 0 && bytes + size > this.chunkBytes) {
        chunks.push(current);
        current = [];
        bytes = 2;
      }
      current.push(item);
      bytes += size;
    }
    if (current.length > 0) chunks.push(current);
    return chunks;
  }

  async applySnapshot(snapshot: SheetMirrorSnapshot): Promise<MirrorApplyResult> {
    const begin = await this.call<BeginResult>('rpc/begin_content_studio_sheet_snapshot', {
      method: 'POST',
      body: JSON.stringify({
        p_schema_version: snapshot.schemaVersion,
        p_source_key: snapshot.sourceKey,
        p_run_id: snapshot.runId,
        p_started_at: snapshot.startedAt,
        p_snapshot_hash: snapshot.snapshotHash,
        p_counts: snapshot.counts,
      }),
    });
    if (begin.state === 'complete') return { ...begin, replayed: true };

    for (const chunk of this.chunks(snapshot.rows)) {
      await this.call<{ staged: number }>('rpc/stage_content_studio_sheet_snapshot', {
        method: 'POST',
        body: JSON.stringify({ p_run_id: snapshot.runId, p_rows: chunk.map((item) => this.wireRow(item)) }),
      });
    }

    return this.call<MirrorApplyResult>('rpc/finalize_content_studio_sheet_snapshot', {
      method: 'POST',
      body: JSON.stringify({ p_run_id: snapshot.runId }),
    });
  }

  async readActive(sourceKey: string): Promise<MirrorRow[]> {
    const out: DbRow[] = [];
    for (let offset = 0; ; offset += this.pageRows) {
      const query = new URLSearchParams({
        source_key: `eq.${sourceKey}`,
        retired_at: 'is.null',
        select: 'collection,stable_id,position,source_row,source_revision,row_hash,payload',
        order: 'collection.asc,position.asc',
        limit: String(this.pageRows),
        offset: String(offset),
      });
      const page = await this.call<DbRow[]>(`content_studio_sheet_rows?${query.toString()}`);
      out.push(...page);
      if (page.length < this.pageRows) break;
    }
    return out.map((item) => ({
      collection: item.collection,
      stableId: item.stable_id,
      position: item.position,
      sourceRow: item.source_row,
      sourceRevision: item.source_revision,
      rowHash: item.row_hash,
      payload: item.payload,
    }));
  }
}
